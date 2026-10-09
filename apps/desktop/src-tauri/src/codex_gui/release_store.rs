//! Persistent candidates are replaced before downloading so a failed newer download
//! can never cause an older cached update to be activated on the next launch.
use super::{
    entrypoint, errors, valid_version, CliStatus, GuiError, Installed, ReleaseInfo, Result,
    MAX_DOWNLOAD,
};
use std::{fs, path::Path};

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|error| {
            errors::failure(
                "parse installation record",
                &error,
                GuiError::InstallStateRead,
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(errors::io(
            "read installation record",
            error,
            GuiError::InstallStateRead,
        )),
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
    valid_version(version) && super::publish_package::ready(&root.join(version))
}

/// Publish under the package guard; copying must not hold the metadata guard.
pub(super) fn stage(root: &Path, version: &str, staging: &Path) -> Result<()> {
    if !valid_version(version) || !staging.join(entrypoint()).is_file() {
        return Err(GuiError::Integrity);
    }
    let destination = root.join(version);
    if !ready(root, version) {
        super::publish_package::directory(staging, &destination)?;
    }
    if !ready(root, version) {
        return Err(errors::invalid(
            "verify installed package",
            "existing version has no executable",
            GuiError::InstallMissingExecutable,
        ));
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
    write_record(&root.join("pending.json"), &candidate)?;
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
    write_record(&root.join("installed.json"), &installed)?;
    Ok(installed)
}

fn write_record(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    let parent = path.parent().ok_or(GuiError::InstallStateWrite)?;
    fs::create_dir_all(parent).map_err(|error| {
        errors::io("create record directory", error, GuiError::InstallDirectory)
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        errors::io(
            "create installation record",
            error,
            GuiError::InstallStateWrite,
        )
    })?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        errors::failure(
            "serialize installation record",
            &error,
            GuiError::InstallStateWrite,
        )
    })?;
    std::io::Write::write_all(&mut temporary, &bytes).map_err(|error| {
        errors::io(
            "write installation record",
            error,
            GuiError::InstallStateWrite,
        )
    })?;
    temporary.persist(path).map_err(|error| {
        errors::io(
            "save installation record",
            error.error,
            GuiError::InstallStateWrite,
        )
    })?;
    Ok(())
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
