//! Fixed internal WebView2 operations; protocol methods are never accepted from model input.
use super::{Error, Result};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

async fn call(view: &tauri::Webview, method: &'static str, parameters: Value) -> Result<Value> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    view.with_webview(move |native| {
        let complete = sender.clone();
        // SAFETY: Tauri invokes this closure on the owning COM apartment. WebView2 retains the
        // callback until completion; the channel carries strings, never COM pointers.
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|core| {
                core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(parameters.to_string()),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |status, result| {
                            if let Ok(mut sender) = complete.lock() {
                                if let Some(sender) = sender.take() {
                                    // A timeout deliberately drops the receiver.
                                    let _ = sender.send(status.map(|_| result));
                                }
                            }
                            Ok(())
                        },
                    )),
                )
            })
        };
        if let Err(error) = result {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    // A timeout deliberately drops the receiver.
                    let _ = sender.send(Err(error));
                }
            }
        }
    })
    .map_err(|_| Error::Unavailable)?;
    let raw = tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    serde_json::from_str(&raw).map_err(|_| Error::Unavailable)
}

pub(super) async fn capture(view: &tauri::Webview) -> Result<Value> {
    call(
        view,
        "Page.captureScreenshot",
        json!({
            "format":"jpeg", "quality":70, "captureBeyondViewport":false,
        }),
    )
    .await
}

pub(super) async fn key(view: &tauri::Webview, key: &str) -> Result<Value> {
    let code = match key {
        "Backspace" => 8,
        "Tab" => 9,
        "Enter" => 13,
        "Escape" => 27,
        "End" => 35,
        "Home" => 36,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "Delete" => 46,
        _ => return Err(Error::Invalid),
    };
    let mut down = json!({"type":"keyDown", "key":key, "code":key, "windowsVirtualKeyCode":code});
    if key == "Enter" {
        down["text"] = json!("\r");
    }
    call(view, "Input.dispatchKeyEvent", down).await?;
    call(
        view,
        "Input.dispatchKeyEvent",
        json!({
            "type":"keyUp", "key":key, "code":key, "windowsVirtualKeyCode":code,
        }),
    )
    .await?;
    Ok(json!({"dispatched":true}))
}
