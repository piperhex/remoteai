//! Offline import of the official complete package, with optional release metadata verification.
use super::{
    asset_name, errors, root, select_asset, store, unpack, updates, valid_version, Asset,
    CliStatus, CliUpdateState, GuiError, Release, ReleaseInfo, Result, MAX_DOWNLOAD, RELEASE_API,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const RELEASE_PAGE: &str = "https://github.com/openai/codex/releases";
const MAX_METADATA: u64 = 2 * 1024 * 1024;
const COPY_BUFFER: usize = 256 * 1024;
const PACKAGE_LAYOUT_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    layout_version: u32,
    version: String,
    target: String,
    variant: String,
    entrypoint: String,
    resources_dir: String,
    path_dir: String,
}

fn platform_label() -> String {
    let system = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        _ => "Linux",
    };
    let architecture = if cfg!(target_arch = "aarch64") {
        "ARM64"
    } else {
        "x64"
    };
    format!("{system} / {architecture}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualDownload {
    asset_name: String,
    platform: String,
    package_url: String,
    metadata_url: String,
    release_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportRequest {
    package_path: PathBuf,
    metadata_path: Option<PathBuf>,
}

fn download_links(version: Option<&str>) -> Result<ManualDownload> {
    let name = asset_name()?;
    let (package_base, metadata_url, release_url) = match version {
        Some(version) if valid_version(version) => (
            format!("{RELEASE_PAGE}/download/rust-v{version}"),
            format!("{RELEASE_API}/tags/rust-v{version}"),
            format!("{RELEASE_PAGE}/tag/rust-v{version}"),
        ),
        Some(_) => return Err(GuiError::InvalidRequest),
        None => (
            format!("{RELEASE_PAGE}/latest/download"),
            format!("{RELEASE_API}/latest"),
            format!("{RELEASE_PAGE}/latest"),
        ),
    };
    Ok(ManualDownload {
        package_url: format!("{package_base}/{name}"),
        asset_name: name,
        platform: platform_label(),
        metadata_url,
        release_url,
    })
}

/// Generate links locally so the guide works even when release checks cannot connect.
#[tauri::command]
pub(crate) async fn codex_gui_cli_manual_download(
    version: Option<String>,
) -> std::result::Result<ManualDownload, String> {
    download_links(version.as_deref()).map_err(|error| error.to_string())
}

fn local_file(path: &Path, maximum: u64) -> Result<fs::File> {
    if !path.is_absolute() {
        return Err(errors::invalid(
            "locate selected file",
            "path is not absolute",
            GuiError::ImportFile,
        ));
    }
    let path = path
        .canonicalize()
        .map_err(|error| errors::io("locate selected file", error, GuiError::ImportFile))?;
    let file = fs::File::open(path)
        .map_err(|error| errors::io("open selected file", error, GuiError::ImportFile))?;
    let metadata = file
        .metadata()
        .map_err(|error| errors::io("inspect selected file", error, GuiError::ImportFile))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(errors::invalid(
            "inspect selected file",
            &format!(
                "is_file={}, bytes={}, maximum={maximum}",
                metadata.is_file(),
                metadata.len()
            ),
            GuiError::ImportFile,
        ));
    }
    Ok(file)
}

fn read_release(path: &Path) -> Result<(String, Asset)> {
    let file = local_file(path, MAX_METADATA)?;
    let mut bytes = Vec::new();
    file.take(MAX_METADATA + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| errors::io("read verification file", error, GuiError::ImportFile))?;
    if bytes.len() as u64 > MAX_METADATA {
        return Err(GuiError::ImportMetadata);
    }
    let release: Release = serde_json::from_slice(&bytes).map_err(|error| {
        errors::failure("parse verification file", &error, GuiError::ImportMetadata)
    })?;
    select_asset(release).map_err(|error| {
        errors::failure("select verified package", &error, GuiError::ImportMetadata)
    })
}

fn expected_digest(asset: &Asset) -> Result<&str> {
    asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            errors::invalid(
                "read package checksum",
                "missing or invalid SHA-256 digest",
                GuiError::ImportMetadata,
            )
        })
}

fn copy_package(source: &Path, destination: &Path, asset: Option<&Asset>) -> Result<u64> {
    let expected = asset.map(expected_digest).transpose()?;
    let mut source = local_file(source, MAX_DOWNLOAD)?;
    let size = source
        .metadata()
        .map_err(|error| errors::io("inspect selected package", error, GuiError::ImportFile))?
        .len();
    if asset.is_some_and(|asset| size != asset.size) {
        return Err(errors::invalid(
            "verify package size",
            "size differs from release metadata",
            GuiError::ImportMismatch,
        ));
    }
    let mut destination = fs::File::create(destination)
        .map_err(|error| errors::io("create import copy", error, GuiError::InstallWrite))?;
    let mut buffer = vec![0; COPY_BUFFER];
    let mut hash = Sha256::new();
    let mut copied = 0;
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|error| errors::io("read selected package", error, GuiError::ImportFile))?;
        if count == 0 {
            break;
        }
        copied += count as u64;
        if copied > size {
            return Err(errors::invalid(
                "copy selected package",
                "source grew while copying",
                GuiError::ImportMismatch,
            ));
        }
        hash.update(&buffer[..count]);
        destination
            .write_all(&buffer[..count])
            .map_err(|error| errors::io("copy selected package", error, GuiError::InstallWrite))?;
    }
    let digest = format!("{:x}", hash.finalize());
    if copied != size || expected.is_some_and(|expected| !digest.eq_ignore_ascii_case(expected)) {
        return Err(errors::invalid(
            "verify imported package",
            "size or SHA-256 mismatch",
            GuiError::ImportMismatch,
        ));
    }
    Ok(copied)
}

/// Read the bundled identity without executing any imported code or accessing the network.
fn package_version(staging: &Path) -> Result<String> {
    let file = local_file(&staging.join("codex-package.json"), MAX_METADATA)
        .map_err(|_| GuiError::ImportPackage)?;
    let package: PackageManifest =
        serde_json::from_reader(file.take(MAX_METADATA + 1)).map_err(|error| {
            errors::failure("parse package manifest", &error, GuiError::ImportPackage)
        })?;
    if package.layout_version != PACKAGE_LAYOUT_VERSION
        || !valid_version(&package.version)
        || format!("codex-package-{}.tar.gz", package.target) != asset_name()?
        || package.variant != "codex"
        || package.entrypoint != super::entrypoint()
        || package.resources_dir != "codex-resources"
        || package.path_dir != "codex-path"
        || !staging.join(&package.resources_dir).is_dir()
        || !staging.join(&package.path_dir).is_dir()
    {
        return Err(errors::invalid(
            "validate package manifest",
            "unsupported layout, version, target or missing package resources",
            GuiError::ImportPackage,
        ));
    }
    Ok(package.version)
}

fn check_version(root: &Path, version: &str) -> Result<()> {
    let imported = semver::Version::parse(version).map_err(|error| {
        errors::failure("parse imported version", &error, GuiError::ImportMetadata)
    })?;
    let status = store::status(root)?;
    let installed = status
        .version
        .as_deref()
        .and_then(|value| semver::Version::parse(value).ok());
    let pending = status
        .release
        .and_then(|value| semver::Version::parse(&value.version).ok());
    if installed.is_some_and(|current| !imported.cmp_precedence(&current).is_gt())
        || pending.is_some_and(|current| imported.cmp_precedence(&current).is_lt())
    {
        return Err(GuiError::ImportVersion);
    }
    Ok(())
}

fn prepare_import(
    root: &Path,
    request: &ImportRequest,
) -> Result<(tempfile::TempDir, ReleaseInfo)> {
    let release = request
        .metadata_path
        .as_deref()
        .map(read_release)
        .transpose()?;
    fs::create_dir_all(root).map_err(|error| {
        errors::io("create import directory", error, GuiError::InstallDirectory)
    })?;
    let temporary = tempfile::Builder::new()
        .prefix("import-")
        .tempdir_in(root)
        .map_err(|error| {
            errors::io(
                "create temporary import directory",
                error,
                GuiError::InstallDirectory,
            )
        })?;
    let archive = temporary.path().join("package.tar.gz");
    let size = copy_package(
        &request.package_path,
        &archive,
        release.as_ref().map(|(_, asset)| asset),
    )?;
    let staging = temporary.path().join("unpacked");
    fs::create_dir(&staging).map_err(|error| {
        errors::io(
            "create extraction directory",
            error,
            GuiError::InstallDirectory,
        )
    })?;
    unpack(&archive, &staging)?;
    let version = match release {
        Some((version, _)) => version,
        None => package_version(&staging)?,
    };
    Ok((
        temporary,
        ReleaseInfo {
            version,
            size,
            ready: true,
        },
    ))
}

fn commit_import(root: &Path, staging: &Path, release: ReleaseInfo) -> Result<()> {
    check_version(root, &release.version)?;
    store::stage(root, &release.version, staging)?;
    store::remember(root, release)?;
    // There cannot be an active managed CLI on first installation.
    if store::installed(root)?.version.is_none() {
        store::activate(root)?;
    }
    Ok(())
}

fn import_package(app: &AppHandle, request: ImportRequest) -> Result<()> {
    updates::initialize(app);
    let root = root(app)?;
    let (temporary, release) = prepare_import(&root, &request)?;
    let state = app.state::<CliUpdateState>();
    let outcome = {
        let _metadata = state.metadata.lock().map_err(|error| {
            errors::failure("lock installation records", &error, GuiError::Install)
        })?;
        commit_import(&root, &temporary.path().join("unpacked"), release)
    };
    if let Err(error) = temporary.close() {
        // Cleanup must not replace the actual installation result.
        errors::io("clean up import files", error, GuiError::InstallWrite);
    }
    outcome
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_import(
    app: AppHandle,
    request: ImportRequest,
) -> std::result::Result<CliStatus, String> {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || import_package(&worker_app, request))
        .await
        .map_err(|error| {
            errors::failure("run installation worker", &error, GuiError::Install).to_string()
        })?
        .map_err(|error| error.to_string())?;
    updates::apply_import(&app)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "release_import_tests.rs"]
mod tests;
