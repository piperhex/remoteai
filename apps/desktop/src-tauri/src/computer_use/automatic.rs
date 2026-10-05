use super::{install, platform, state, ComputerError, Result, CHANGES};
use std::{fs, path::Path};

const SETUP_DIRECTORY: &str = "gui-setup";

/// Run on a blocking worker before starting the GUI's app-server.
pub(crate) fn setup_gui(home: &Path, installing: impl FnOnce()) -> Result<()> {
    if platform::asset().is_err() {
        return Ok(());
    }
    let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
    let root = super::root()?;
    setup_with(&root, home, installing, || install::install(&root, home))?;
    install::refresh_installed(&root, home)
}

fn setup_with(
    root: &Path,
    home: &Path,
    installing: impl FnOnce(),
    install: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let marker = root.join(SETUP_DIRECTORY).join(state::home_id(home));
    if marker.try_exists().map_err(|_| ComputerError::Storage)? {
        return Ok(());
    }
    let previously_installed = state::read(root, &state::home_id(home))?.is_some();
    // Persist before attempting installation: reconnects must not repeatedly download or undo a removal.
    // Failed setup remains repairable through the marketplace's existing install/repair action.
    remember(root, home)?;
    if previously_installed {
        return Ok(());
    }
    installing();
    install()
}

pub(super) fn remember(root: &Path, home: &Path) -> Result<()> {
    let directory = root.join(SETUP_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|_| ComputerError::Storage)?;
    crate::storage::write_text_atomic(&directory.join(state::home_id(home)), "1")
        .map_err(|_| ComputerError::Storage)
}

#[cfg(test)]
#[path = "automatic_tests.rs"]
mod tests;
