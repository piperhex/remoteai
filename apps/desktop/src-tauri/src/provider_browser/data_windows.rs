use super::{data::ClearRequest, passwords::Login, BrowserError, Result};
use std::{sync::mpsc, time::Duration};
use tauri::Emitter;
use webview2_com::{
    take_pwstr, ClearBrowsingDataCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    WebMessageReceivedEventHandler,
};
use windows::core::{Interface, PWSTR};

pub(super) fn clear(view: &tauri::Webview, request: ClearRequest) -> Result<()> {
    let (send, receive) = mpsc::channel();
    view.with_webview(move |view| {
        let completion = send.clone();
        // SAFETY: Tauri executes this callback on the live controller's COM apartment. The completion
        // owns its sender and no COM pointer escapes to the worker waiting for the result.
        let result = unsafe {
            let core = view.controller().CoreWebView2();
            core.and_then(|core| {
                let mut kinds = COREWEBVIEW2_BROWSING_DATA_KINDS(0);
                if request.cookies {
                    kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES
                        | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE;
                }
                if request.cache {
                    kinds |= COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE;
                }
                core.cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile2>()?
                    .ClearBrowsingData(
                        kinds,
                        &ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                            // A timed-out request has already surfaced a failure to its caller.
                            let _ = completion.send(result.is_ok());
                            Ok(())
                        })),
                    )
            })
        };
        if result.is_err() && send.send(false).is_err() {
            eprintln!("Browser clear receiver closed");
        }
    })
    .map_err(|_| BrowserError::Unavailable)?;
    if receive
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| BrowserError::Unavailable)?
    {
        Ok(())
    } else {
        Err(BrowserError::Unavailable)
    }
}

pub(super) unsafe fn install_capture(
    core: &ICoreWebView2,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    let id = label.trim_start_matches(super::LABEL_PREFIX).to_string();
    // SAFETY: Registration and handler run on the owning COM apartment. WebMessageReceived is scoped
    // to the top-level document; its native source URL is checked before forwarding credentials.
    unsafe {
        let mut token = 0;
        core.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut source = PWSTR::null();
                args.Source(&mut source)?;
                let source = take_pwstr(source);
                let mut raw = PWSTR::null();
                args.WebMessageAsJson(&mut raw)?;
                let raw = take_pwstr(raw);
                forward_login_message(&app, &id, &source, &raw);
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

fn forward_login_message(app: &tauri::AppHandle, id: &str, source: &str, raw: &str) {
    const MAX_MESSAGE_BYTES: usize = 40_000;
    if raw.len() > MAX_MESSAGE_BYTES {
        return;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return;
    };
    let value = if let Some(text) = value.as_str() {
        let Ok(value) = serde_json::from_str(text) else {
            return;
        };
        value
    } else {
        value
    };
    match value["type"].as_str() {
        Some("browser-login-focus") => {
            let Ok(focus) = serde_json::from_value::<super::password_focus::PasswordFocus>(
                value["focus"].clone(),
            ) else {
                return;
            };
            if focus.valid_for(source)
                && app
                    .emit_to("main", &format!("browser-login-focus-{id}"), &focus)
                    .is_err()
            {
                eprintln!("Browser login suggestions unavailable");
            }
        }
        Some("browser-login") => {
            let Ok(login) = serde_json::from_value::<Login>(value["login"].clone()) else {
                return;
            };
            if login.valid_for(source)
                && app
                    .emit_to("main", &format!("browser-login-{id}"), login)
                    .is_err()
            {
                eprintln!("Browser login notification unavailable");
            }
        }
        _ => {}
    }
}
