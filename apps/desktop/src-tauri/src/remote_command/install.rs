use super::{state, RemoteError, Result, HELPER_ARGUMENT, MCP_SERVER};
use std::{
    fs,
    path::{Path, PathBuf},
};
use toml_edit::{value, Array, Table};

const SKILL_NAME: &str = "codex-switch-remote-command";
const MARKER: &str = "<!-- managed:codex-switch-remote-command -->";
const SKILL: &str =
    include_str!("../../resources/codex-switch-remote-command/skills/remote-command/SKILL.md");

fn entry(home: &Path, enabled: bool) -> Result<Table> {
    let executable = std::env::current_exe().map_err(|_| RemoteError::Storage)?;
    let mut table = Table::new();
    table["command"] = value(executable.to_string_lossy().as_ref());
    table["args"] = value(Array::from_iter([format!(
        "{HELPER_ARGUMENT}{}",
        state::home_id(home)
    )]));
    table["enabled"] = value(enabled);
    table["startup_timeout_sec"] = value(10);
    table["tool_timeout_sec"] = value(100);
    #[cfg(windows)]
    crate::windows_plugin_host::configure_entry(&mut table);
    Ok(table)
}

fn update(home: &Path, enabled: Option<bool>) -> Result<()> {
    crate::codex_settings::update_managed_mcp(
        home,
        MCP_SERVER,
        &format!("{HELPER_ARGUMENT}{}", state::home_id(home)),
        enabled.map(|enabled| entry(home, enabled)).transpose()?,
    )
    .map_err(|error| match error {
        crate::codex_settings::ManagedMcpError::ForeignEntry => RemoteError::Conflict,
        crate::codex_settings::ManagedMcpError::Storage => RemoteError::Storage,
    })
}

fn skill_path(home: &Path) -> PathBuf {
    home.join("skills").join(SKILL_NAME).join("SKILL.md")
}

fn check_skill(home: &Path) -> Result<()> {
    match fs::read_to_string(skill_path(home)) {
        Ok(content) if content.contains(MARKER) => Ok(()),
        Ok(_) => Err(RemoteError::Conflict),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(RemoteError::Storage),
    }
}

pub(super) fn configured(home: &Path, enabled: bool) -> Result<bool> {
    let matches =
        crate::codex_settings::managed_mcp_matches(home, MCP_SERVER, &entry(home, enabled)?)
            .map_err(|_| RemoteError::Storage)?;
    Ok(matches
        && (!enabled
            || fs::read_to_string(skill_path(home))
                .is_ok_and(|content| content.replace("\r\n", "\n") == SKILL.replace("\r\n", "\n"))))
}

/// Refresh owned entries after an application update without changing grants or disabled preferences.
pub(super) fn refresh_installed(root: &Path) -> Result<()> {
    let _guard = super::INSTALL_CHANGES
        .lock()
        .map_err(|_| RemoteError::Storage)?;
    let homes = match fs::read_dir(root.join("homes")) {
        Ok(homes) => homes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(RemoteError::Storage),
    };
    for entry in homes {
        let entry = entry.map_err(|_| RemoteError::Storage)?;
        let id = entry
            .path()
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_owned();
        if let Err(error) = refresh_home(root, &id) {
            eprintln!("remote command configuration refresh: {error}");
        }
    }
    Ok(())
}

fn refresh_home(root: &Path, id: &str) -> Result<()> {
    let Some(record) = state::read(root, id)? else {
        return Ok(());
    };
    if !record.home.is_dir() {
        return Ok(());
    }
    check_skill(&record.home)?;
    update(&record.home, Some(record.enabled))?;
    if record.enabled {
        let path = skill_path(&record.home);
        fs::create_dir_all(path.parent().ok_or(RemoteError::Storage)?)
            .map_err(|_| RemoteError::Storage)?;
        crate::storage::write_text_atomic(&path, SKILL).map_err(|_| RemoteError::Storage)?;
    }
    Ok(())
}

pub(super) fn install(root: &Path, home: &Path) -> Result<()> {
    check_skill(home)?;
    fs::create_dir_all(home).map_err(|_| RemoteError::Storage)?;
    update(home, Some(false))?;
    let mut record = state::Record {
        home: home.to_owned(),
        enabled: false,
        token: format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
    };
    state::save(root, &record)?;
    fs::create_dir_all(home.join("skills").join(SKILL_NAME)).map_err(|_| RemoteError::Storage)?;
    crate::storage::write_text_atomic(&skill_path(home), SKILL)
        .map_err(|_| RemoteError::Storage)?;
    update(home, Some(true))?;
    record.enabled = true;
    state::save(root, &record)
}

pub(super) fn disable(root: &Path, home: &Path, remove: bool) -> Result<()> {
    super::automatic::remember(root, home)?;
    if let Some(mut record) = state::read(root, &state::home_id(home))? {
        record.enabled = false;
        state::save(root, &record)?;
    }
    update(home, if remove { None } else { Some(false) })?;
    let skill = skill_path(home);
    if skill.exists() && check_skill(home).is_ok() {
        fs::remove_file(skill).map_err(|_| RemoteError::Storage)?;
    }
    let record = state::record_path(root, &state::home_id(home))?;
    if remove && record.exists() {
        fs::remove_file(record).map_err(|_| RemoteError::Storage)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
