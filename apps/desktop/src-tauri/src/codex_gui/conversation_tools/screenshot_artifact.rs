//! Durable image references for model-requested captures, separate from preview polling.
use super::{Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};
use tauri::Manager;

const MAX_ENCODED_BYTES: usize = 2_000_000;
const DELIVERY_HINT: &str = "The tool image is visible in execution details, not automatically in the reply. \
    When the user asks for the screenshot, include screenshot.markdown once in your final response, \
    adding a concise descriptive alt text. Do not add another link to the same image or claim it is \
    shown above without embedding it. The saved file remains available after the browser tab closes.";

pub(super) async fn attach(app: tauri::AppHandle, value: Value) -> Result<Value> {
    // Saving is only part of the MCP tool path. Remote preview frames must never create artifacts.
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|_| unavailable())?;
        save(&root.join("browser-screenshots"), value)
    })
    .await
    .map_err(|_| unavailable())?
}

fn unavailable() -> Error {
    Error::Browser(crate::provider_browser::automation::Error::Unavailable)
}

fn save(directory: &Path, mut value: Value) -> Result<Value> {
    let image = &value["result"]["image"];
    let encoded = image["data"]
        .as_str()
        .filter(|data| !data.is_empty() && data.len() <= MAX_ENCODED_BYTES)
        .ok_or_else(unavailable)?;
    if image["mimeType"] != "image/jpeg" {
        return Err(unavailable());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| unavailable())?;
    if image::guess_format(&bytes).ok() != Some(image::ImageFormat::Jpeg) {
        return Err(unavailable());
    }
    fs::create_dir_all(directory).map_err(|_| unavailable())?;
    let directory = directory.canonicalize().map_err(|_| unavailable())?;
    let mut file = tempfile::Builder::new()
        .prefix("screenshot-")
        .suffix(".jpg")
        .tempfile_in(directory)
        .map_err(|_| unavailable())?;
    file.write_all(&bytes).map_err(|_| unavailable())?;
    let (_, path) = file.keep().map_err(|_| unavailable())?;
    let path = crate::codex_gui::platform::execution_path(&path);
    #[cfg(windows)]
    let path = path.replace('\\', "/");
    value["result"]["screenshot"] = json!({
        "path": path,
        "markdown": format!("![](<{path}>)"),
        "deliveryHint": DELIVERY_HINT,
    });
    Ok(value)
}

#[cfg(test)]
#[path = "screenshot_artifact_tests.rs"]
mod tests;
