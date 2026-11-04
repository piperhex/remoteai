use super::{
    platform,
    state::{CozeState, Phase},
    Error, Result,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};

const MAX_ARCHIVE: u64 = 768 * 1024 * 1024;
const MAX_UNPACKED: u64 = 1536 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Registry {
    pub version: String,
    release_tag: String,
    repository: String,
    protocol: u32,
    public_key: String,
}

pub(super) fn registry() -> Result<Registry> {
    serde_json::from_str(include_str!("../../../../../shared/coze/runtime.json"))
        .map_err(|_| Error::Integrity)
}

pub(super) fn directory(root: &Path) -> Result<PathBuf> {
    Ok(root.join("packages").join(registry()?.version))
}

pub(super) fn installed(root: &Path) -> Result<bool> {
    let directory = directory(root)?;
    Ok(directory.join("complete.json").is_file()
        && validate_package(&directory, &registry()?.version).is_ok())
}

pub(super) fn install(root: &Path, state: &CozeState) -> Result<()> {
    if installed(root)? {
        return Ok(());
    }
    let registry = registry()?;
    if registry.protocol != 1 {
        return Err(Error::Integrity);
    }
    platform::private_directory(root)?;
    let staging = tempfile::Builder::new()
        .prefix("download-")
        .tempdir_in(root)
        .map_err(|_| Error::Storage)?;
    let filename = format!("coze-{}.zip", platform::package_target()?);
    let base = format!(
        "https://github.com/{}/releases/download/{}",
        registry.repository, registry.release_tag
    );
    let client = crate::system_proxy::apply(reqwest::blocking::Client::builder())
        .user_agent("RemoteAI-Coze")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| Error::Download)?;
    let archive = staging.path().join("package.zip");
    download(&client, &format!("{base}/{filename}"), &archive, state)?;
    let signature = read_small(&client, &format!("{base}/{filename}.sig"))?;
    state.progress(Phase::Verifying, 0, None)?;
    let bytes = fs::read(&archive).map_err(|_| Error::Storage)?;
    verify(&bytes, &signature)?;
    drop(bytes);
    state.progress(Phase::Installing, 0, None)?;
    let extracted = staging.path().join("package");
    fs::create_dir(&extracted).map_err(|_| Error::Storage)?;
    extract(&archive, &extracted)?;
    validate_package(&extracted, &registry.version)?;
    platform::make_executable(&extracted.join(platform::executable()))?;
    platform::make_executable(&extracted.join(platform::python_worker()))?;
    fs::write(
        extracted.join("complete.json"),
        serde_json::json!({"version":registry.version}).to_string(),
    )
    .map_err(|_| Error::Storage)?;
    let destination = directory(root)?;
    fs::create_dir_all(destination.parent().ok_or(Error::Storage)?).map_err(|_| Error::Storage)?;
    replace_package(&extracted, &destination, staging.path())?;
    Ok(())
}

fn replace_package(extracted: &Path, destination: &Path, staging: &Path) -> Result<()> {
    let backup = staging.join("previous-package");
    if destination.exists() {
        fs::rename(destination, &backup).map_err(|_| Error::Storage)?;
    }
    if fs::rename(extracted, destination).is_err() {
        if backup.exists() {
            fs::rename(&backup, destination).map_err(|_| Error::Storage)?;
        }
        return Err(Error::Storage);
    }
    // The temporary directory owns the retired package; persistent user data lives outside packages/.
    Ok(())
}

fn download(
    client: &reqwest::blocking::Client,
    url: &str,
    path: &Path,
    state: &CozeState,
) -> Result<()> {
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| Error::Download)?;
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_ARCHIVE) {
        return Err(Error::Integrity);
    }
    let mut file = fs::File::create(path).map_err(|_| Error::Storage)?;
    let mut downloaded = 0;
    let mut buffer = [0_u8; 64 * 1024];
    state.progress(Phase::Downloading, 0, total)?;
    loop {
        let count = response.read(&mut buffer).map_err(|_| Error::Download)?;
        if count == 0 {
            break;
        }
        downloaded += count as u64;
        if downloaded > MAX_ARCHIVE {
            return Err(Error::Integrity);
        }
        file.write_all(&buffer[..count])
            .map_err(|_| Error::Storage)?;
        state.progress(Phase::Downloading, downloaded, total)?;
    }
    if downloaded == 0 || total.is_some_and(|size| size != downloaded) {
        return Err(Error::Download);
    }
    file.sync_all().map_err(|_| Error::Storage)?;
    Ok(())
}

fn read_small(client: &reqwest::blocking::Client, url: &str) -> Result<String> {
    let response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|_| Error::Download)?;
    let mut text = String::new();
    response
        .take(16 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|_| Error::Download)?;
    if text.len() > 16 * 1024 {
        return Err(Error::Integrity);
    }
    Ok(text)
}

fn verify(bytes: &[u8], signature: &str) -> Result<()> {
    let registry = registry()?;
    let key = &registry.public_key;
    let decode = |value: &str| -> Result<String> {
        String::from_utf8(
            STANDARD
                .decode(value.trim())
                .map_err(|_| Error::Integrity)?,
        )
        .map_err(|_| Error::Integrity)
    };
    let key = minisign_verify::PublicKey::decode(&decode(key)?).map_err(|_| Error::Integrity)?;
    let signature =
        minisign_verify::Signature::decode(&decode(signature)?).map_err(|_| Error::Integrity)?;
    key.verify(bytes, &signature, true)
        .map_err(|_| Error::Integrity)
}

fn extract(archive: &Path, destination: &Path) -> Result<()> {
    let file = fs::File::open(archive).map_err(|_| Error::Storage)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| Error::Integrity)?;
    if zip.len() > 2000 {
        return Err(Error::Integrity);
    }
    let mut names = HashSet::new();
    let mut total = 0_u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| Error::Integrity)?;
        let relative = entry.enclosed_name().ok_or(Error::Integrity)?;
        validate_path(&relative)?;
        total = total.checked_add(entry.size()).ok_or(Error::Integrity)?;
        if total > MAX_UNPACKED
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            || !names.insert(relative.to_string_lossy().to_lowercase())
        {
            return Err(Error::Integrity);
        }
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(target).map_err(|_| Error::Storage)?;
            continue;
        }
        fs::create_dir_all(target.parent().ok_or(Error::Integrity)?).map_err(|_| Error::Storage)?;
        let mut output = fs::File::create(target).map_err(|_| Error::Storage)?;
        let copied = std::io::copy(&mut entry.by_ref().take(MAX_UNPACKED + 1), &mut output)
            .map_err(|_| Error::Integrity)?;
        if copied != entry.size() {
            return Err(Error::Integrity);
        }
    }
    Ok(())
}

fn validate_path(path: &Path) -> Result<()> {
    if path.components().any(|part| match part {
        Component::Normal(name) => name.to_string_lossy().contains(':'),
        _ => true,
    }) {
        return Err(Error::Integrity);
    }
    Ok(())
}

fn validate_package(root: &Path, version: &str) -> Result<()> {
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("package.json")).map_err(|_| Error::Integrity)?)
            .map_err(|_| Error::Integrity)?;
    if manifest["version"] != version || manifest["protocol"] != 1 {
        return Err(Error::Integrity);
    }
    for name in [
        platform::executable(),
        platform::python_worker(),
        "ui/index.html",
        "models/config.json",
        "models/tokenizer.json",
        "models/model.safetensors",
        "NOTICE.md",
        "LICENSE-APACHE",
    ] {
        if !root.join(name).is_file() {
            return Err(Error::Integrity);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
