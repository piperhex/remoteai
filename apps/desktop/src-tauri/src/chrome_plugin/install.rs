use std::{fs, path::Path};
use toml_edit::{value, Array, Table};

use super::{
    config::{self, ClientRecord},
    extension, registration, BrowserError, Result, MCP_SERVER,
};

fn mcp_entry(executable: &Path, id: &str, enabled: bool) -> Table {
    let mut table = Table::new();
    table["command"] = value(executable.to_string_lossy().as_ref());
    table["args"] = value(Array::from_iter([format!("--chrome-mcp={id}")]));
    table["enabled"] = value(enabled);
    table["startup_timeout_sec"] = value(10);
    table["tool_timeout_sec"] = value(150);
    #[cfg(windows)]
    crate::windows_plugin_host::configure_entry(&mut table);
    table
}

fn update_config(home: &Path, id: &str, entry: Option<Table>) -> Result<()> {
    crate::codex_settings::update_managed_mcp(
        home,
        MCP_SERVER,
        &format!("--chrome-mcp={id}"),
        entry,
    )
    .map_err(|error| match error {
        crate::codex_settings::ManagedMcpError::ForeignEntry => BrowserError::Conflict,
        crate::codex_settings::ManagedMcpError::Storage => BrowserError::Storage,
    })
}

pub(super) fn install(root: &Path, home: &Path, executable: &Path) -> Result<()> {
    if !registration::supported() {
        return Err(BrowserError::Unsupported);
    }
    install_home(root, home, executable, || {
        extension::export(root)?;
        registration::register(root, executable)
    })
}

/// Prepare the built-in plugin once without re-enabling an existing disabled installation.
pub(super) fn ensure_installed(root: &Path, home: &Path, executable: &Path) -> Result<()> {
    ensure_home(root, home, || install(root, home, executable))
}

/// Refresh owned configuration without changing credentials or the user's enabled preference.
pub(super) fn refresh_home(root: &Path, home: &Path, executable: &Path) -> Result<()> {
    let id = config::client_id(home);
    let record = config::load(root, &id)?;
    update_config(home, &id, Some(mcp_entry(executable, &id, record.enabled)))?;
    if record.enabled {
        extension::skill(home)?;
    }
    Ok(())
}

fn ensure_home(root: &Path, home: &Path, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
    match config::load(root, &config::client_id(home)) {
        Ok(_) => Ok(()),
        Err(BrowserError::Disabled) => prepare(),
        Err(error) => Err(error),
    }
}

fn install_home(
    root: &Path,
    home: &Path,
    executable: &Path,
    prepare: impl FnOnce() -> Result<()>,
) -> Result<()> {
    fs::create_dir_all(home).map_err(|_| BrowserError::Storage)?;
    let id = config::client_id(home);
    let mut record = match config::load(root, &id) {
        Ok(record) => record,
        Err(BrowserError::Disabled) => ClientRecord {
            home: home.to_owned(),
            token: config::new_token(),
            enabled: false,
        },
        Err(error) => return Err(error),
    };
    // Detect a foreign entry before installing anything; partial failures stay disabled and are repairable.
    update_config(home, &id, Some(mcp_entry(executable, &id, false)))?;
    record.enabled = false;
    config::save(root, &id, &record)?;
    prepare()?;
    extension::skill(home)?;
    update_config(home, &id, Some(mcp_entry(executable, &id, true)))?;
    record.enabled = true;
    config::save(root, &id, &record)
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;

pub(super) fn disable(root: &Path, home: &Path, executable: &Path) -> Result<()> {
    let id = config::client_id(home);
    let mut record = config::load(root, &id)?;
    record.enabled = false;
    config::save(root, &id, &record)?;
    extension::remove_skill(home)?;
    update_config(home, &id, Some(mcp_entry(executable, &id, false)))
}

pub(super) fn configured(home: &Path, enabled: bool) -> Result<bool> {
    let executable = std::env::current_exe().map_err(|_| BrowserError::Storage)?;
    crate::codex_settings::managed_mcp_matches(
        home,
        MCP_SERVER,
        &mcp_entry(&executable, &config::client_id(home), enabled),
    )
    .map_err(|_| BrowserError::Storage)
}

pub(super) fn remove(root: &Path, home: &Path) -> Result<()> {
    let id = config::client_id(home);
    let mut record = config::load(root, &id)?;
    record.enabled = false;
    config::save(root, &id, &record)?;
    update_config(home, &id, None)?;
    extension::remove_skill(home)?;
    fs::remove_file(config::client_path(root, &id)?).map_err(|_| BrowserError::Storage)?;
    let clients = fs::read_dir(root.join("clients")).map_err(|_| BrowserError::Storage)?;
    if clients.count() == 0 {
        registration::unregister(root)?;
    }
    Ok(())
}
