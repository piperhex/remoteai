use super::{Action, Error, Result};
use serde_json::{json, Value};
use std::time::Duration;

pub(super) async fn execute(view: &tauri::Webview, action: &Action) -> Result<Value> {
    #[cfg(windows)]
    if let Action::Key { key } = action {
        return super::devtools::key(view, key).await;
    }
    let mut args = serde_json::to_value(action).map_err(|_| Error::Invalid)?;
    if matches!(action, Action::Snapshot) {
        args["snapshotId"] = json!(uuid::Uuid::new_v4().to_string());
    }
    if matches!(
        action,
        Action::Click { .. } | Action::Type { .. } | Action::Select { .. }
    ) {
        let mut preview = args.clone();
        preview["previewOnly"] = json!(true);
        evaluate(view, &preview).await?;
        tokio::time::sleep(Duration::from_millis(180)).await;
    }
    evaluate(view, &args).await
}

async fn evaluate(view: &tauri::Webview, args: &Value) -> Result<Value> {
    // Reuse the exact Chrome assistant pointer implementation without its module exports.
    let pointer = include_str!("../../../resources/chrome-extension/pointer-overlay.js")
        .replace("export ", "");
    let script = format!(
        "(()=>{{{pointer}; const keyboard = {}; return ({})({args});}})()",
        include_str!("keyboard.js"),
        include_str!("page.js")
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    view.eval_with_callback(script, move |value| {
        if let Ok(mut sender) = sender.lock() {
            if let Some(sender) = sender.take() {
                // A timeout or closed tab deliberately retires its callback receiver.
                let _ = sender.send(value);
            }
        }
    })
    .map_err(|_| Error::Unavailable)?;
    let raw = tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|_| Error::Unavailable)?;
    // WebKit returns a serialized string, whereas WebView2 can return the JSON value directly.
    if let Some(text) = value.as_str() {
        value = serde_json::from_str(text).map_err(|_| Error::Unavailable)?;
    }
    if value["error"] == "stale" {
        return Err(Error::Stale);
    }
    if value.get("error").is_some() {
        return Err(Error::Unavailable);
    }
    Ok(json!(value))
}
