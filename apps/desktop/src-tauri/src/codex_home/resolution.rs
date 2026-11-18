use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use tauri::Runtime;

use super::{current_overrides, gui_home, paths_match, ConfiguredCodexHome};

const CODEX_HOME_ENV: &str = "CODEX_HOME";
const DEFAULT_CODEX_HOME_DIRECTORY: &str = ".codex";

// Set once by application startup, before settings migration or any home resolution.
static PREVIOUS_HOMES: OnceLock<Vec<PathBuf>> = OnceLock::new();
static GUI_HOME: OnceLock<PathBuf> = OnceLock::new();

/// Identify the private GUI home before interpreting an inherited CODEX_HOME.
pub(crate) fn initialize_paths<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    super::location::initialize(app)?;
    PREVIOUS_HOMES.get_or_init(|| {
        super::location::history(app)
            .into_iter()
            .map(|h| PathBuf::from(h.path))
            .collect()
    });
    let path = gui_home(app)?;
    if GUI_HOME.get_or_init(|| path.clone()) != &path {
        return Err("Codex Home 初始化失败，请重启应用。".to_string());
    }
    Ok(())
}

fn is_previous(path: &Path) -> bool {
    PREVIOUS_HOMES
        .get()
        .is_some_and(|homes| homes.iter().any(|home| paths_match(path, home)))
}

fn environment_codex_home() -> Option<PathBuf> {
    std::env::var_os(CODEX_HOME_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| !is_previous(path))
}

fn resolve_from_sources(
    configured: Option<PathBuf>,
    environment: Option<PathBuf>,
    home: Option<PathBuf>,
    built_in_home: Option<&Path>,
) -> Result<PathBuf, String> {
    // A Switch launched by the built-in agent inherits its private CODEX_HOME.
    // Treating that as the external default lets GUI deduplication erase the default entry.
    let is_external =
        |path: &PathBuf| !built_in_home.is_some_and(|built_in| paths_match(path, built_in));
    configured
        .filter(is_external)
        .or_else(|| environment.filter(is_external))
        .or_else(|| home.map(|path| path.join(DEFAULT_CODEX_HOME_DIRECTORY)))
        .ok_or_else(|| "无法定位用户 Home 目录".to_string())
}

pub(crate) fn resolve() -> Result<PathBuf, String> {
    let configured = external_overrides();
    resolve_for_override(configured.first().map(|entry| entry.path.as_path()))
}

pub(crate) fn resolve_default() -> Result<PathBuf, String> {
    resolve_for_override(None)
}

pub(crate) fn resolve_all() -> Result<Vec<ConfiguredCodexHome>, String> {
    let configured = external_overrides();
    if !configured.is_empty() {
        return Ok(configured);
    }
    Ok(vec![ConfiguredCodexHome {
        id: None,
        path: resolve_default()?,
    }])
}

fn external_overrides() -> Vec<ConfiguredCodexHome> {
    // Legacy settings and directory aliases can bypass the GUI entry's disabled flag.
    current_overrides()
        .into_iter()
        .filter(|home| {
            !is_previous(&home.path)
                && GUI_HOME
                    .get()
                    .is_none_or(|gui| !paths_match(&home.path, gui))
        })
        .collect()
}

pub(super) fn resolve_for_override(value: Option<&Path>) -> Result<PathBuf, String> {
    resolve_from_sources(
        value.map(Path::to_path_buf),
        environment_codex_home(),
        dirs::home_dir(),
        GUI_HOME.get().map(PathBuf::as_path),
    )
}

#[cfg(test)]
mod startup_tests;
#[cfg(test)]
mod tests;
