use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

use crate::models::CodexHomeEntry;

pub(crate) const GUI_CODEX_HOME_ID: &str = "codex-gui";

/// Shared with GUI startup so the built-in entry always points at the runtime's home.
pub(crate) fn gui_home<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(locations) = app.try_state::<super::location::RuntimeLocations>() {
        return Ok(locations.current.clone());
    }
    default_gui_home(app)
}

pub(crate) fn default_gui_home<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(".codex"))
        .map_err(|_| "无法定位内置 Codex GUI 目录".to_string())
}

/// Enforce the write boundary even before the process-wide home cache is initialized.
pub(crate) fn ensure_external_home(path: &Path, gui: &Path) -> Result<(), String> {
    if super::paths_match(path, gui) {
        return Err("请为外部 Codex 选择单独的 Home 目录，再重试。".to_string());
    }
    Ok(())
}

pub(crate) fn ensure_gui_entry(entries: &mut Vec<CodexHomeEntry>, path: &Path) -> bool {
    let original = entries.clone();
    entries.retain(|entry| {
        entry.id != GUI_CODEX_HOME_ID && !super::paths_match(Path::new(&entry.path), path)
    });
    entries.push(CodexHomeEntry {
        id: GUI_CODEX_HOME_ID.to_string(),
        path: path.to_string_lossy().into_owned(),
        // GUI credentials and routing must never be overwritten by global account switches.
        enabled: false,
    });
    *entries != original
}

/// Resolve only saved home IDs. Disabled sync targets remain available for manual management.
pub(crate) fn resolve_selected<R: Runtime>(
    app: &tauri::AppHandle<R>,
    home_id: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(id) = home_id else {
        return super::resolve();
    };
    let settings = crate::storage::read_app_settings(app)?;
    selected_path(&settings.codex_homes, id)
}

/// Historical homes are exposed only as sources for an explicit conversation sync.
pub(crate) fn resolve_sync_source<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<PathBuf, String> {
    if super::location::is_history_id(id) {
        return selected_path(&super::location::history(app), id);
    }
    resolve_selected(app, Some(id))
}

fn selected_path(entries: &[CodexHomeEntry], id: &str) -> Result<PathBuf, String> {
    entries
        .iter()
        .find(|entry| entry.id == id)
        .map(|entry| PathBuf::from(&entry.path))
        .filter(|path| super::is_safe_home_path(path))
        .ok_or_else(|| "该 Codex Home 已移除或不可用，请重新选择".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_entry_is_fixed_deduplicated_and_excluded_from_shared_switches() {
        let path = std::env::temp_dir().join("gui-home");
        let mut entries = Vec::new();
        assert!(ensure_gui_entry(&mut entries, &path));
        assert!(!entries[0].enabled);
        assert!(!ensure_gui_entry(&mut entries, &path));
        entries[0].enabled = false;
        assert!(!ensure_gui_entry(&mut entries, &path));
        assert!(!entries[0].enabled);
        entries.push(CodexHomeEntry {
            id: "custom".into(),
            path: path.to_string_lossy().into_owned(),
            enabled: true,
        });
        ensure_gui_entry(&mut entries, &path);
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].enabled);
        assert_eq!(entries[0].id, GUI_CODEX_HOME_ID);
    }

    #[test]
    fn selection_accepts_disabled_homes_but_rejects_unsaved_paths() {
        let path = std::env::temp_dir().join("selected-home");
        let entries = vec![CodexHomeEntry {
            id: "saved".into(),
            path: path.to_string_lossy().into_owned(),
            enabled: false,
        }];
        assert_eq!(selected_path(&entries, "saved").unwrap(), path);
        assert!(selected_path(&entries, "removed").is_err());
        assert!(selected_path(&entries, path.to_str().unwrap()).is_err());
    }
}
