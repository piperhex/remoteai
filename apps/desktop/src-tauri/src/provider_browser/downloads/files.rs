use super::{Action, Error, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

fn record(app: &AppHandle, id: &str) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| Error::Unavailable)?
        .join("browser-download-records")
        .join(format!("{id}.json")))
}

pub(super) fn completed(app: AppHandle, id: String, path: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<()> {
            let record = record(&app, &id)?;
            std::fs::create_dir_all(record.parent().ok_or(Error::Unavailable)?)
                .map_err(|_| Error::Unavailable)?;
            let value = serde_json::to_vec(&path).map_err(|_| Error::Unavailable)?;
            std::fs::write(record, value).map_err(|_| Error::Unavailable)
        })();
        if let Err(error) = result {
            eprintln!("Browser download record failed: {error}");
        }
    });
}

pub(super) fn open(app: &AppHandle, id: &str, action: Action, live: Option<PathBuf>) -> Result<()> {
    let path = match live {
        Some(path) => path,
        None => {
            let value = std::fs::read(record(app, id)?).map_err(|_| Error::Unavailable)?;
            serde_json::from_slice::<PathBuf>(&value).map_err(|_| Error::Unavailable)?
        }
    };
    if !path.is_file() {
        return Err(Error::Unavailable);
    }
    if matches!(action, Action::Reveal) {
        tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|_| Error::Unavailable)
    } else {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|_| Error::Unavailable)
    }
}

pub(super) fn target(app: &AppHandle, id: &str, suggested: &str) -> Result<PathBuf> {
    let name = Path::new(suggested).file_name().ok_or(Error::Invalid)?;
    // Each transfer owns a unique directory, so identical names never overwrite an existing download.
    Ok(app
        .path()
        .download_dir()
        .map_err(|_| Error::Unavailable)?
        .join("Remote AI")
        .join(id)
        .join(name))
}
