//! Persistent candidates are replaced before downloading so a failed newer download
//! can never cause an older cached update to be activated on the next launch.
use super::{
    entrypoint, valid_version, CliStatus, GuiError, Installed, ReleaseInfo, Result, MAX_DOWNLOAD,
};
use std::{fs, path::Path};

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| GuiError::Install),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(GuiError::Install),
    }
}

pub(super) fn installed(root: &Path) -> Result<Installed> {
    let installed =
        read::<Installed>(&root.join("installed.json"))?.unwrap_or(Installed { version: None });
    Ok(Installed {
        version: installed.version.filter(|version| ready(root, version)),
    })
}

/// Return cached update information without contacting the release server.
pub(super) fn status(root: &Path) -> Result<CliStatus> {
    let version = installed(root)?.version;
    let release = pending(root)?.filter(|candidate| {
        version
            .as_deref()
            .is_none_or(|installed| newer(&candidate.version, installed))
    });
    Ok(CliStatus { version, release })
}

pub(super) fn ready(root: &Path, version: &str) -> bool {
    valid_version(version) && root.join(version).join(entrypoint()).is_file()
}

/// Publish only complete packages, with the metadata guard held by every writer.
pub(super) fn stage(root: &Path, version: &str, staging: &Path) -> Result<()> {
    if !valid_version(version) || !staging.join(entrypoint()).is_file() {
        return Err(GuiError::Integrity);
    }
    let destination = root.join(version);
    if !destination.exists() {
        fs::rename(staging, destination).map_err(|_| GuiError::Install)?;
    }
    if !ready(root, version) {
        return Err(GuiError::Install);
    }
    Ok(())
}

pub(super) fn pending(root: &Path) -> Result<Option<ReleaseInfo>> {
    let Some(mut candidate) = read::<ReleaseInfo>(&root.join("pending.json"))? else {
        return Ok(None);
    };
    if !valid_version(&candidate.version) || candidate.size > MAX_DOWNLOAD {
        return Err(GuiError::Integrity);
    }
    candidate.ready = ready(root, &candidate.version);
    Ok(Some(candidate))
}

fn newer(candidate: &str, current: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(current),
    ) {
        (Ok(candidate), Ok(current)) => candidate.cmp_precedence(&current).is_gt(),
        _ => false,
    }
}

/// Call while holding the metadata guard; network requests must happen beforehand.
pub(super) fn remember(root: &Path, mut candidate: ReleaseInfo) -> Result<ReleaseInfo> {
    if let Some(pending) = pending(root)? {
        if !newer(&candidate.version, &pending.version) {
            candidate = pending;
        }
    }
    if let Some(version) = installed(root)?.version {
        if !newer(&candidate.version, &version) {
            return Ok(ReleaseInfo {
                version,
                size: 0,
                ready: false,
            });
        }
    }
    candidate.ready = ready(root, &candidate.version);
    fs::create_dir_all(root).map_err(|_| GuiError::Install)?;
    crate::storage::write_json_atomic(&root.join("pending.json"), &serde_json::json!(candidate))
        .map_err(|_| GuiError::Install)?;
    Ok(candidate)
}

/// Activation only changes the pointer after a complete, verified package exists.
pub(super) fn activate(root: &Path) -> Result<Installed> {
    let current = installed(root)?;
    let Some(candidate) = pending(root)? else {
        return Ok(current);
    };
    if !candidate.ready
        || current
            .version
            .as_deref()
            .is_some_and(|v| !newer(&candidate.version, v))
    {
        return Ok(current);
    }
    let installed = Installed {
        version: Some(candidate.version),
    };
    crate::storage::write_json_atomic(&root.join("installed.json"), &serde_json::json!(installed))
        .map_err(|_| GuiError::Install)?;
    Ok(installed)
}

pub(super) fn activation_candidate(root: &Path, expected: &str) -> Result<bool> {
    Ok(
        pending(root)?.is_some_and(|candidate| candidate.ready && candidate.version == expected)
            && installed(root)?
                .version
                .as_deref()
                .is_some_and(|version| newer(expected, version)),
    )
}

/// Recheck under the metadata guard: a newer discovery can supersede a staged restart.
pub(super) fn activate_expected(root: &Path, expected: &str) -> Result<Option<Installed>> {
    if !activation_candidate(root, expected)? {
        return Ok(None);
    }
    activate(root).map(Some)
}

#[cfg(test)]
#[path = "release_store_tests.rs"]
pub(super) mod tests;
