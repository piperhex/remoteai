use super::error::{GuiError, Result};
#[path = "release_errors.rs"]
mod errors;
#[path = "release_import.rs"]
pub(crate) mod manual;
#[path = "release_publish.rs"]
mod publish_package;
#[path = "release_store.rs"]
mod store;
#[cfg(test)]
#[path = "release_tests.rs"]
mod tests;
#[path = "release_updates.rs"]
pub(crate) mod updates;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
pub(crate) use updates::{codex_gui_cli_check, codex_gui_cli_prepare, start, CliUpdateState};

const RELEASE_API: &str = "https://api.github.com/repos/openai/codex/releases";
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Installed {
    pub(crate) version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliStatus {
    version: Option<String>,
    release: Option<ReleaseInfo>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseInfo {
    version: String,
    size: u64,
    #[serde(default)]
    ready: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: u64,
    phase: &'static str,
}

pub(super) fn root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| {
            errors::failure("locate installation directory", &error, GuiError::Startup)
        })?
        .join("codex-cli"))
}

fn valid_version(version: &str) -> bool {
    version.len() < 80 && semver::Version::parse(version).is_ok()
}

pub(super) fn installed(app: &AppHandle) -> Result<Installed> {
    updates::initialize(app);
    store::installed(&root(app)?)
}

pub(super) struct Executable {
    pub(super) path: PathBuf,
    pub(super) version: String,
}

pub(super) fn executable(app: &AppHandle) -> Result<Executable> {
    let version = installed(app)?.version.ok_or(GuiError::Executable)?;
    Ok(Executable {
        path: root(app)?.join(&version).join(entrypoint()),
        version,
    })
}

fn entrypoint() -> &'static str {
    if cfg!(windows) {
        "bin/codex.exe"
    } else {
        "bin/codex"
    }
}

/// Recognize GUI-managed CLI versions so external client restarts leave them running.
#[cfg(any(unix, test))]
pub(crate) fn is_gui_executable(path: &std::path::Path) -> bool {
    let Some(bin) = path
        .parent()
        .filter(|parent| parent.file_name().is_some_and(|name| name == "bin"))
    else {
        return false;
    };
    let Some(version) = bin.parent() else {
        return false;
    };
    path.file_name()
        .is_some_and(|name| name == "codex" || name == "codex.exe")
        && version
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(valid_version)
        && version
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|name| name == "codex-cli")
}

fn asset_name() -> Result<String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        _ => return Err(GuiError::Release),
    };
    let platform = match std::env::consts::OS {
        "windows" => "pc-windows-msvc",
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-musl",
        _ => return Err(GuiError::Release),
    };
    Ok(format!("codex-package-{arch}-{platform}.tar.gz"))
}

fn http_client() -> Result<Client> {
    crate::system_proxy::apply(Client::builder())
        .user_agent("Codex-Switch-GUI")
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| errors::failure("prepare download connection", &error, GuiError::Release))
}

fn release(client: &Client, version: Option<&str>) -> Result<(String, Asset)> {
    let endpoint = if let Some(version) = version {
        if !valid_version(version) {
            return Err(GuiError::InvalidRequest);
        }
        format!("{RELEASE_API}/tags/rust-v{version}")
    } else {
        format!("{RELEASE_API}/latest")
    };
    let release: Release = client
        .get(endpoint)
        .timeout(Duration::from_secs(25))
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json())
        .map_err(|error| errors::failure("fetch release information", &error, GuiError::Release))?;
    select_asset(release)
}

fn select_asset(release: Release) -> Result<(String, Asset)> {
    let version = release
        .tag_name
        .strip_prefix("rust-v")
        .filter(|version| valid_version(version))
        .ok_or(GuiError::Release)?
        .to_owned();
    let name = asset_name()?;
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .ok_or(GuiError::Release)?;
    let expected_url =
        format!("https://github.com/openai/codex/releases/download/rust-v{version}/{name}");
    if asset.browser_download_url != expected_url || asset.size > MAX_DOWNLOAD {
        return Err(GuiError::Release);
    }
    Ok((version, asset))
}

fn publish(app: &AppHandle, progress: Progress) {
    super::web::publish(app, "codex-gui-download", progress);
}

fn download(
    progress: impl Fn(Progress),
    client: &Client,
    asset: &Asset,
    path: &Path,
) -> Result<()> {
    let expected = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64)
        .ok_or(GuiError::Integrity)?;
    let mut response = client
        .get(&asset.browser_download_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| errors::failure("download package", &error, GuiError::Release))?;
    let mut file = fs::File::create(path)
        .map_err(|error| errors::io("create download file", error, GuiError::InstallWrite))?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut downloaded = 0;
    let mut last_percent = 0;
    loop {
        let count = response.read(&mut buffer).map_err(|error| {
            errors::failure("read download response", &error, GuiError::Release)
        })?;
        if count == 0 {
            break;
        }
        downloaded += count as u64;
        if downloaded > asset.size || downloaded > MAX_DOWNLOAD {
            return Err(GuiError::Integrity);
        }
        hash.update(&buffer[..count]);
        file.write_all(&buffer[..count])
            .map_err(|error| errors::io("write download file", error, GuiError::InstallWrite))?;
        let percent = downloaded * 100 / asset.size.max(1);
        if percent > last_percent {
            progress(Progress {
                downloaded,
                total: asset.size,
                phase: "downloading",
            });
            last_percent = percent;
        }
    }
    if downloaded != asset.size || format!("{:x}", hash.finalize()) != expected {
        return Err(GuiError::Integrity);
    }
    Ok(())
}

pub(super) fn unpack(archive: &Path, destination: &Path) -> Result<()> {
    let file = fs::File::open(archive)
        .map_err(|error| errors::io("open archive", error, GuiError::InstallRead))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    unpack_entries(&mut archive, destination)?;
    // Tar can stop before gzip validates its trailer; drain it to reject truncated packages.
    let remaining = std::io::copy(
        &mut archive.into_inner().take(MAX_DOWNLOAD * 4 + 1),
        &mut std::io::sink(),
    )
    .map_err(|error| errors::io("verify gzip trailer", error, GuiError::InstallUnpack))?;
    if remaining > MAX_DOWNLOAD * 4 {
        return Err(errors::invalid(
            "verify gzip trailer",
            "trailing data exceeds limit",
            GuiError::Integrity,
        ));
    }
    if !destination.join(entrypoint()).is_file() {
        return Err(errors::invalid(
            "verify executable",
            entrypoint(),
            GuiError::InstallMissingExecutable,
        ));
    }
    Ok(())
}

fn unpack_entries(archive: &mut tar::Archive<impl Read>, destination: &Path) -> Result<()> {
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|error| errors::io("read archive", error, GuiError::InstallUnpack))?
    {
        let mut entry = entry
            .map_err(|error| errors::io("read archive entry", error, GuiError::InstallUnpack))?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err(errors::invalid(
                "validate archive entry",
                "unsupported entry type",
                GuiError::Integrity,
            ));
        }
        total = total.checked_add(entry.size()).ok_or_else(|| {
            errors::invalid(
                "validate archive size",
                "entry size overflow",
                GuiError::Integrity,
            )
        })?;
        if total > MAX_DOWNLOAD * 4 {
            return Err(errors::invalid(
                "validate archive size",
                "extracted size exceeds limit",
                GuiError::Integrity,
            ));
        }
        if !entry
            .unpack_in(destination)
            .map_err(|error| errors::io("extract archive entry", error, GuiError::InstallUnpack))?
        {
            return Err(errors::invalid(
                "validate archive path",
                "entry escapes installation folder",
                GuiError::Integrity,
            ));
        }
    }
    Ok(())
}

fn prepare_package(app: &AppHandle, version: &str, asset: &Asset, silent: bool) -> Result<()> {
    let root = root(app)?;
    let client = http_client()?;
    fs::create_dir_all(&root).map_err(|error| {
        errors::io(
            "create install directory",
            error,
            GuiError::InstallDirectory,
        )
    })?;
    let archive = root.join(format!("download-{}.tar.gz", uuid::Uuid::new_v4()));
    let staging = root.join(format!("staging-{}", uuid::Uuid::new_v4()));
    let outcome = (|| {
        download(
            |progress| {
                if !silent {
                    publish(app, progress);
                }
            },
            &client,
            asset,
            &archive,
        )?;
        if !silent {
            publish(
                app,
                Progress {
                    downloaded: asset.size,
                    total: asset.size,
                    phase: "installing",
                },
            );
        }
        fs::create_dir(&staging).map_err(|error| {
            errors::io(
                "create extraction directory",
                error,
                GuiError::InstallDirectory,
            )
        })?;
        unpack(&archive, &staging)?;
        let state = app.state::<CliUpdateState>();
        let _publication = state.publication.lock().map_err(|error| {
            errors::failure("lock package publication", &error, GuiError::Install)
        })?;
        store::stage(&root, version, &staging)?;
        Ok(())
    })();
    cleanup_package(&root, &archive, &staging);
    outcome
}

fn cleanup_package(root: &Path, archive: &Path, staging: &Path) {
    // These paths are generated children of the verified installation root, never frontend input.
    if archive.is_file() && fs::remove_file(archive).is_err() {
        eprintln!("Codex GUI download cleanup failed");
    }
    if staging.is_dir() && staging.parent() == Some(root) && fs::remove_dir_all(staging).is_err() {
        eprintln!("Codex GUI staging cleanup failed");
    }
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_status(app: AppHandle) -> std::result::Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || updates::status(&app))
        .await
        .map_err(|_| GuiError::Startup.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_release() -> std::result::Result<ReleaseInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (version, asset) = release(&http_client()?, None)?;
        Ok(ReleaseInfo {
            version,
            size: asset.size,
            ready: false,
        })
    })
    .await
    .map_err(|_| GuiError::Release.to_string())?
    .map_err(|error: GuiError| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_install(
    app: AppHandle,
    version: String,
) -> std::result::Result<Installed, String> {
    if !valid_version(&version) {
        return Err(GuiError::InvalidRequest.to_string());
    }
    // The displayed version is only a hint: a newer release may have arrived since the last check.
    updates::install(app)
        .await
        .map_err(|error| error.to_string())
}
