use super::{BrowserError, Result};
use std::{collections::BTreeMap, sync::mpsc, time::Duration};
use tauri::{Emitter, Manager};
use webview2_com::{
    take_pwstr, Microsoft::Web::WebView2::Win32::*, NewWindowRequestedEventHandler,
    WebResourceRequestedEventHandler,
};
use windows::core::{w, HSTRING, PWSTR};

pub(super) fn stop(view: &tauri::Webview) -> Result<()> {
    let (sender, receiver) = mpsc::sync_channel(1);
    view.with_webview(move |view| {
        // SAFETY: Tauri runs this callback on the live WebView2 controller's COM apartment.
        // Stop also cancels navigation before a document exists, when script evaluation cannot.
        let result = unsafe {
            view.controller()
                .CoreWebView2()
                .and_then(|core| core.Stop())
        };
        if sender.send(result).is_err() {
            eprintln!("Browser stop receiver closed");
        }
    })
    .map_err(|_| BrowserError::Unavailable)?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| BrowserError::Unavailable)?
        .map_err(|_| BrowserError::Unavailable)
}

pub(super) fn configure_headers(
    view: &tauri::Webview,
    origin: &str,
    headers: &BTreeMap<String, String>,
) -> Result<()> {
    let origin = origin.to_string();
    let headers = headers.clone();
    let app = view.app_handle().clone();
    let event = view.label().to_string();
    let (sender, receiver) = mpsc::sync_channel(1);
    view.with_webview(move |view| {
        // SAFETY: Tauri executes this callback on the WebView's owning COM apartment. The controller
        // is live for this callback, and WebView2 owns the registered handler until the view closes.
        let result = unsafe {
            view.controller().CoreWebView2().and_then(|core| {
                super::super::data_windows::install_capture(&core, app.clone(), event.clone())?;
                super::super::inspector::windows::install(
                    &core,
                    &view.controller(),
                    app.clone(),
                    event.clone(),
                )?;
                install_popup(&core, app, event)?;
                if !headers.is_empty() {
                    install(&core, origin, headers)?;
                }
                Ok(())
            })
        };
        if sender.send(result).is_err() {
            eprintln!("Provider browser header setup receiver closed");
        }
    })
    .map_err(|_| BrowserError::Unavailable)?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| BrowserError::Unavailable)?
        .map_err(|_| BrowserError::Unavailable)
}

unsafe fn install_popup(
    view: &ICoreWebView2,
    app: tauri::AppHandle,
    event: String,
) -> windows::core::Result<()> {
    let origin = app.config().build.dev_url.as_ref().map(|url| url.origin());
    // SAFETY: Registration and callback run on the WebView2 COM apartment. The handler owns its app
    // handle and strings. Emitting schedules frontend work; it never creates another view inside COM.
    unsafe {
        let mut token = 0;
        view.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                args.SetHandled(true)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if let Ok(url) = url::Url::parse(&uri) {
                    if super::super::allowed_url(&url, origin.as_ref()) {
                        if let Err(error) = app.emit_to(
                            "main",
                            &event,
                            serde_json::json!({"url":uri, "popup":true}),
                        ) {
                            eprintln!("Provider browser tab notification failed: {error}");
                        }
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

unsafe fn install(
    view: &ICoreWebView2,
    origin: String,
    headers: BTreeMap<String, String>,
) -> windows::core::Result<()> {
    // SAFETY: Called only on the owning COM apartment with a live WebView2. All strings passed to COM
    // remain alive for their call; the callback owns its header data and consumes the allocated URI.
    unsafe {
        view.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
        let mut token = 0;
        view.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let request = args.Request()?;
                let mut uri = PWSTR::null();
                request.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                let same_origin = url::Url::parse(&uri)
                    .is_ok_and(|url| url.origin().ascii_serialization() == origin);
                let request_headers = request.Headers()?;
                for (name, value) in &headers {
                    if same_origin {
                        request_headers.SetHeader(&HSTRING::from(name), &HSTRING::from(value))?;
                    } else {
                        request_headers.RemoveHeader(&HSTRING::from(name))?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}
