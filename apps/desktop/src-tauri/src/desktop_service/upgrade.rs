//! Elevated updates preserve the installed identity and policy, with the old runtime available for rollback.
use super::{assets, configuration, installer, platform, Result, ServiceError};
use semver::Version;
use std::path::{Path, PathBuf};
use windows_service::service::ServiceState;

pub(super) fn run(version: &str) -> Result<()> {
    if !platform::elevated()? {
        return Err(ServiceError::Denied);
    }
    let target = Version::parse(version).map_err(|_| ServiceError::Invalid)?;
    // Recheck after administrator confirmation: a stopped/uninstalled service stays untouched.
    if !installer::query()?.is_some_and(|status| status.current_state == ServiceState::Running) {
        return Ok(());
    }
    let original = configuration::read()?;
    if !original.permissions.enabled || !can_replace(&original.version, &target)? {
        return Ok(());
    }
    let mut replacement = Replacement::prepare(
        &installer::source_executable()?,
        configuration::install_root()?,
    )?;
    update_staged(&mut replacement, &target)
}

fn update_staged(replacement: &mut Replacement, target: &Version) -> Result<()> {
    if !installer::query()?.is_some_and(|status| status.current_state == ServiceState::Running) {
        return Ok(());
    }
    installer::stop()?;
    // Read after shutdown so permission changes made while staging are not overwritten.
    let original = match configuration::read() {
        Ok(config) => config,
        Err(error) => {
            installer::start()?;
            return Err(error);
        }
    };
    let result = activate(replacement, &original, target);
    if result.is_err() {
        if let Err(error) = restore(replacement, &original) {
            // A failed rollback must retain the old runtime for repair, never delete the only copy.
            replacement.retain();
            eprintln!("Unattended desktop update rollback failed: {error}");
            return Err(error);
        }
    }
    result
}

fn can_replace(installed: &str, target: &Version) -> Result<bool> {
    let installed = Version::parse(installed).map_err(|_| ServiceError::Invalid)?;
    // Same-version replacement migrates services that predate version reporting.
    Ok(target.cmp_precedence(&installed).is_ge())
}

fn activate(
    replacement: &mut Replacement,
    original: &configuration::Configuration,
    target: &Version,
) -> Result<()> {
    if !original.permissions.enabled || !can_replace(&original.version, target)? {
        return installer::start();
    }
    replacement.replace()?;
    configuration::write(&updated_configuration(original, target))?;
    installer::start()
}

fn updated_configuration(
    original: &configuration::Configuration,
    target: &Version,
) -> configuration::Configuration {
    let mut config = original.clone();
    config.version = target.to_string();
    config
}

fn restore(replacement: &mut Replacement, original: &configuration::Configuration) -> Result<()> {
    installer::stop()?;
    replacement.restore()?;
    configuration::write(original)?;
    installer::start()
}

struct Replacement {
    directory: Option<tempfile::TempDir>,
    root: PathBuf,
    staged: PathBuf,
    backup: PathBuf,
}

impl Replacement {
    fn prepare(executable: &Path, root: PathBuf) -> Result<Self> {
        let source = executable.parent().ok_or(ServiceError::Setup)?;
        let replacement = Self::new(root)?;
        installer::protect_directory(&replacement.staged)?;
        std::fs::copy(executable, replacement.staged.join("csw.exe"))
            .map_err(|_| ServiceError::Storage)?;
        for relative in ["resources/desktop-service", "resources/remote-desktop"] {
            installer::copy_tree(&source.join(relative), &replacement.staged.join(relative))?;
        }
        assets::verify(&replacement.staged)?;
        Ok(replacement)
    }

    fn new(root: PathBuf) -> Result<Self> {
        installer::reject_link(&root)?;
        // All moves remain on the install volume. The temporary directory is private before copying.
        let directory = tempfile::Builder::new()
            .prefix(".codex-switch-desktop-update-")
            .tempdir_in(root.parent().ok_or(ServiceError::Invalid)?)
            .map_err(|_| ServiceError::Storage)?;
        installer::protect_directory(directory.path())?;
        Ok(Self {
            staged: directory.path().join("new"),
            backup: directory.path().join("previous"),
            directory: Some(directory),
            root,
        })
    }

    fn replace(&mut self) -> Result<()> {
        std::fs::rename(&self.root, &self.backup).map_err(|_| ServiceError::Storage)?;
        std::fs::rename(&self.staged, &self.root).map_err(|_| ServiceError::Storage)
    }

    fn restore(&mut self) -> Result<()> {
        if !self.backup.exists() {
            return Ok(());
        }
        if self.root.exists() {
            std::fs::rename(&self.root, &self.staged).map_err(|_| ServiceError::Storage)?;
        }
        std::fs::rename(&self.backup, &self.root).map_err(|_| ServiceError::Storage)
    }

    fn retain(&mut self) {
        if let Some(directory) = self.directory.take() {
            // The fixed-prefix directory stays on disk; its path is not exposed to the frontend.
            drop(directory.keep());
        }
    }
}

#[cfg(test)]
#[path = "upgrade_tests.rs"]
mod tests;
