use super::{BrowserError, Result};
use std::{collections::BTreeMap, sync::mpsc, time::Duration};
use tauri::{Emitter, Manager};
use webview2_com::{
    take_pwstr, ContainsFullScreenElementChangedEventHandler, Microsoft::Web::WebView2::Win32::*,
    NewWindowRequestedEventHandler, SourceChangedEventHandler, WebResourceRequestedEventHandler,
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
    mapped: bool,
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
                super::super::certificates::install(&core, app.clone(), event.clone(), mapped)?;
                super::super::zoom::install(&view.controller(), app.clone(), event.clone())?;
                super::super::downloads::windows::install(&core, app.clone())?;
                super::super::data_windows::install_capture(&core, app.clone(), event.clone())?;
                super::super::inspector::windows::install(
                    &core,
                    &view.controller(),
                    app.clone(),
                    event.clone(),
                )?;
                install_source_changed(&core, app.clone(), event.clone())?;
                install_fullscreen_changed(&core, app.clone(), event.clone())?;
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

fn install_fullscreen_changed(
    view: &ICoreWebView2,
    app: tauri::AppHandle,
    event: String,
) -> windows::core::Result<()> {
    // Tauri already makes the host window fullscreen. Its independently placed child still needs resizing.
    // SAFETY: WebView2 retains this handler and invokes it on the sender's COM apartment.
    unsafe {
        let mut token = 0;
        view.add_ContainsFullScreenElementChanged(
            &ContainsFullScreenElementChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut fullscreen = windows::core::BOOL::default();
                    sender.ContainsFullScreenElement(&mut fullscreen)?;
                    let payload = serde_json::json!({ "pageFullscreen": fullscreen.as_bool() });
                    if let Err(error) = app.emit_to("main", &event, payload) {
                        eprintln!("Browser fullscreen notification failed: {error}");
                    }
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

unsafe fn install_source_changed(
    view: &ICoreWebView2,
    app: tauri::AppHandle,
    event: String,
) -> windows::core::Result<()> {
    let origin = app.config().build.dev_url.as_ref().map(|url| url.origin());
    // SAFETY: Registration and callback run on the live WebView2's owning COM apartment.
    // WebView2 retains the handler; take_pwstr consumes the source string allocated by COM.
    unsafe {
        let mut token = 0;
        view.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, args| {
                let (Some(sender), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let mut source = PWSTR::null();
                sender.Source(&mut source)?;
                let source = take_pwstr(source);
                let Ok(url) = url::Url::parse(&source) else {
                    return Ok(());
                };
                if !super::super::allowed_url(&url, origin.as_ref()) {
                    return Ok(());
                }
                let mut new_document = windows::core::BOOL::default();
                args.IsNewDocument(&mut new_document)?;
                if !new_document.as_bool() {
                    if let Some(view) = app.get_webview(&event) {
                        super::super::lifecycle::same_document_navigation(&view, url);
                        return Ok(());
                    }
                }
                if let Err(error) = app.emit_to("main", &event, serde_json::json!({"url":source})) {
                    eprintln!("Provider browser address notification failed: {error}");
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
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
