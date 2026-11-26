use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use super::{BrowserError, Result};

macro_rules! assets {
    ($($name:literal),+ $(,)?) => {
        &[$(($name, include_bytes!(concat!("../../resources/chrome-extension/", $name)).as_slice())),+]
    };
}

const ASSETS: &[(&str, &[u8])] = assets![
    "manifest.json",
    "background.js",
    "auto-update.js",
    "bundle-version.js",
    "validation.js",
    "permissions.js",
    "site-access.js",
    "driver.js",
    "debugger-connections.js",
    "rendering.js",
    "tab-indicator.js",
    "pointer.js",
    "pointer-overlay.js",
    "tab-groups.js",
    "target-queue.js",
    "finish-task.js",
    "frame-sessions.js",
    "snapshot.js",
    "console-logs.js",
    "console-format.js",
    "console-buffer.js",
    "console-runtime.js",
    "console-objects.js",
    "console-scope.js",
    "console-target.js",
    "console-workers.js",
    "worker-driver.js",
    "actions.js",
    "operations.js",
    "popup.html",
    "popup.js",
    "sidepanel.html",
    "sidepanel.js",
    "sidepanel.css",
    "panel-theme.css",
    "panel-settings.css",
    "approval.html",
    "approval.js",
    "ui.css",
    "icon.png",
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "i18n.js",
    "messages.generated.js",
    "_locales/zh_CN/messages.json",
    "_locales/en/messages.json",
    "_locales/ru/messages.json",
];

const BUNDLE_PLACEHOLDER: &str = "__CODEX_SWITCH_CHROME_BUNDLE__";
const READY_FILE: &str = "bundle-ready.json";

fn bundle_revision() -> &'static str {
    static REVISION: OnceLock<String> = OnceLock::new();
    REVISION.get_or_init(|| {
        let mut hash = Sha256::new();
        for (name, bytes) in ASSETS {
            hash.update(name.as_bytes());
            hash.update([0]);
            hash.update(bytes);
            hash.update([0]);
        }
        format!("{:x}", hash.finalize())
    })
}

pub(super) fn is_current(root: &Path) -> Result<bool> {
    let bytes = match fs::read(directory(root).join(READY_FILE)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(BrowserError::Storage),
    };
    Ok(serde_json::from_slice::<serde_json::Value>(&bytes)
        .is_ok_and(|value| value["revision"] == bundle_revision()))
}

pub(super) fn directory(root: &Path) -> PathBuf {
    root.join("extension")
}

pub(super) fn export(root: &Path) -> Result<PathBuf> {
    let path = directory(root);
    fs::create_dir_all(&path).map_err(|_| BrowserError::Storage)?;
    // Publish the marker only after every file is replaced, so Chrome cannot reload a partial bundle.
    match fs::remove_file(path.join(READY_FILE)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(BrowserError::Storage),
    }
    for (name, bytes) in ASSETS {
        let bytes = if *name == "bundle-version.js" {
            Cow::Owned(
                String::from_utf8_lossy(bytes)
                    .replace(BUNDLE_PLACEHOLDER, bundle_revision())
                    .into_bytes(),
            )
        } else {
            Cow::Borrowed(*bytes)
        };
        write_asset(&path.join(name), &bytes)?;
    }
    crate::storage::write_json_atomic(
        &path.join(READY_FILE),
        &serde_json::json!({"revision": bundle_revision()}),
    )
    .map_err(|_| BrowserError::Storage)?;
    Ok(path)
}

fn write_asset(target: &Path, bytes: &[u8]) -> Result<()> {
    if fs::read(target).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    // Locale messages live in nested `_locales/<locale>/` folders.
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|_| BrowserError::Storage)?;
    }
    let temporary = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, bytes).map_err(|_| BrowserError::Storage)?;
    crate::storage::replace_file(&temporary, target).map_err(|_| BrowserError::Storage)
}

pub(super) fn skill(home: &Path) -> Result<()> {
    let path = home.join("skills").join("codex-switch-chrome");
    let manifest = path.join("SKILL.md");
    if manifest.exists() {
        let existing = fs::read_to_string(&manifest).map_err(|_| BrowserError::Storage)?;
        if !existing.contains("<!-- managed:codex-switch-chrome -->") {
            return Err(BrowserError::Conflict);
        }
    }
    fs::create_dir_all(path).map_err(|_| BrowserError::Storage)?;
    crate::storage::write_text_atomic(
        &manifest,
        include_str!("../../resources/chrome-extension/SKILL.md"),
    )
    .map_err(|_| BrowserError::Storage)
}

pub(super) fn remove_skill(home: &Path) -> Result<()> {
    let path = home
        .join("skills")
        .join("codex-switch-chrome")
        .join("SKILL.md");
    if !path.exists() {
        return Ok(());
    }
    let existing = fs::read_to_string(&path).map_err(|_| BrowserError::Storage)?;
    if !existing.contains("<!-- managed:codex-switch-chrome -->") {
        return Ok(());
    }
    fs::remove_file(path).map_err(|_| BrowserError::Storage)
}

#[cfg(test)]
#[path = "extension_tests.rs"]
mod tests;
