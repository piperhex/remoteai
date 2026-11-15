use super::{Command, Error, Result};
use serde_json::{json, Value};

#[cfg(not(windows))]
pub(super) async fn execute(_: &tauri::Webview, _: Command) -> Result<Value> {
    Err(Error::Unsupported)
}

#[cfg(windows)]
pub(super) async fn execute(view: &tauri::Webview, command: Command) -> Result<Value> {
    use crate::provider_browser::automation::devtools;
    match command {
        Command::Click { x, y } => {
            coordinates(x, y)?;
            for kind in ["mousePressed", "mouseReleased"] {
                devtools::call(
                    view,
                    "Input.dispatchMouseEvent",
                    json!({"type": kind,
                    "x": x, "y": y, "button": "left", "clickCount": 1}),
                )
                .await
                .map_err(|_| Error::Engine)?;
            }
        }
        Command::Scroll { x, y, delta } => {
            coordinates(x, y)?;
            if !delta.is_finite() || delta.abs() > 10_000.0 {
                return Err(Error::Invalid);
            }
            devtools::call(
                view,
                "Input.dispatchMouseEvent",
                json!({"type": "mouseWheel",
                "x": x, "y": y, "deltaX": 0, "deltaY": delta}),
            )
            .await
            .map_err(|_| Error::Engine)?;
        }
        Command::Text { text } => {
            if text.len() > 16_000 {
                return Err(Error::Invalid);
            }
            devtools::call(view, "Input.insertText", json!({"text": text}))
                .await
                .map_err(|_| Error::Engine)?;
        }
        Command::Key { key } => {
            devtools::key(view, &key)
                .await
                .map_err(|_| Error::Invalid)?;
        }
        _ => return Err(Error::Invalid),
    }
    Ok(json!({}))
}

#[cfg(windows)]
fn coordinates(x: f64, y: f64) -> Result<()> {
    if [x, y]
        .iter()
        .any(|value| !value.is_finite() || !(0.0..=4096.0).contains(value))
    {
        return Err(Error::Invalid);
    }
    Ok(())
}
