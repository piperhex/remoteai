//! Extend only the engine's own overridable TLS warning. WebView2 remains responsible for
//! evaluating certificates and enforcing HSTS, revocation, and enterprise policy on every visit.
mod copy;
mod store;

use super::automation::devtools::{call, call_until_closed};
use super::automation::{Error, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
    DevToolsProtocolEventReceivedEventHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
use windows::core::{w, PWSTR};

const ERROR_DOCUMENT: &str = "chrome-error://chromewebdata/";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    url: String,
    loader_id: String,
    parent_id: Option<String>,
    unreachable_url: Option<url::Url>,
}

#[derive(Deserialize)]
struct Navigation {
    frame: Frame,
}

impl Frame {
    fn is_interstitial(&self) -> bool {
        self.parent_id.is_none()
            && self.url == ERROR_DOCUMENT
            && self
                .unreachable_url
                .as_ref()
                .is_some_and(|url| url.scheme() == "https")
    }
}

pub(super) fn install(
    core: &ICoreWebView2,
    app: AppHandle,
    label: String,
    mapped: bool,
) -> windows::core::Result<()> {
    // SAFETY: WebView2 owns the event handler and calls it on the controller's COM apartment.
    unsafe {
        let receiver = core.GetDevToolsProtocolEventReceiver(w!("Page.frameNavigated"))?;
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = PWSTR::null();
                args.ParameterObjectAsJson(&mut raw)?;
                let navigation = serde_json::from_str::<Navigation>(&take_pwstr(raw));
                if let Some(frame) = navigation
                    .ok()
                    .map(|n| n.frame)
                    .filter(Frame::is_interstitial)
                {
                    inspect(app.clone(), label.clone(), frame, mapped);
                }
                Ok(())
            }));
        receiver.add_DevToolsProtocolEventReceived(&handler, &mut 0)?;
        core.CallDevToolsProtocolMethod(
            w!("Page.enable"),
            w!("{}"),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|result, _| result)),
        )
    }
}

fn inspect(app: AppHandle, label: String, frame: Frame, mapped: bool) {
    tauri::async_runtime::spawn(async move {
        let Some(view) = app.get_webview(&label) else {
            return;
        };
        let Some(url) = frame.unreachable_url.as_ref() else {
            return;
        };
        let dev_origin = app.config().build.dev_url.as_ref().map(url::Url::origin);
        if !super::allowed_url(url, dev_origin.as_ref()) {
            return;
        }
        let Ok(root) = app.path().app_data_dir() else {
            return;
        };
        // Closing or navigating the tab invalidates its DevTools handles; the original warning
        // also remains usable when an engine update changes its interstitial structure.
        let _result = handle(&view, &frame, store::location(&root, url, mapped)).await;
    });
}

async fn handle(view: &Webview, frame: &Frame, path: std::path::PathBuf) -> Result<()> {
    let group = format!("certificate-{}", frame.loader_id);
    let result = bind_document(view, frame, &group, path).await;
    // Closing or navigating the tab also releases every object in this group.
    let _released = call(
        view,
        "Runtime.releaseObjectGroup",
        json!({"objectGroup":group}),
    )
    .await;
    result
}

async fn bind_document(
    view: &Webview,
    frame: &Frame,
    group: &str,
    path: std::path::PathBuf,
) -> Result<()> {
    let document = call(
        view,
        "Runtime.evaluate",
        json!({"expression":"document", "objectGroup":group}),
    )
    .await?;
    let document = object_id(&document)?;
    // The event and the second loader check bracket acquisition of the object. All subsequent
    // calls stay bound to this document and cannot cross a navigation or a redirect.
    let tree = call(view, "Page.getFrameTree", json!({})).await?;
    let current: Frame =
        serde_json::from_value(tree["frameTree"]["frame"].clone()).map_err(|_| Error::Invalid)?;
    if current.url != ERROR_DOCUMENT
        || current.parent_id.is_some()
        || current.loader_id != frame.loader_id
        || current.unreachable_url != frame.unreachable_url
    {
        return Ok(());
    }
    let page = call(
        view,
        "Runtime.callFunctionOn",
        json!({"objectId":document,
        "functionDeclaration":include_str!("interstitial.js"),"awaitPromise":true}),
    )
    .await?;
    let Some(object) = page["result"]["objectId"].as_str() else {
        return Ok(());
    };
    decide(view, object, path).await
}

fn object_id(reply: &Value) -> Result<&str> {
    reply["result"]["objectId"]
        .as_str()
        .ok_or(Error::Unavailable)
}

async fn decide(view: &Webview, object: &str, path: std::path::PathBuf) -> Result<()> {
    let metadata = call(
        view,
        "Runtime.callFunctionOn",
        json!({"objectId":object,"returnByValue":true,
        "functionDeclaration":"function(){return [this.pem,this.reason]}"}),
    )
    .await?;
    let pair = &metadata["result"]["value"];
    let pin = store::Pin::from_interstitial(
        pair[0].as_str().ok_or(Error::Invalid)?,
        pair[1].as_str().ok_or(Error::Invalid)?,
    )
    .ok_or(Error::Invalid)?;
    let source = path.clone();
    let previous = tauri::async_runtime::spawn_blocking(move || store::read(&source))
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    if previous.as_ref() != Some(&pin) {
        let options = json!({"fingerprint":pin.fingerprint,"changed":previous.is_some(),"copy":copy::current()});
        let choice = call_until_closed(view, "Runtime.callFunctionOn", json!({"objectId":object,"awaitPromise":true,
            "returnByValue":true,"functionDeclaration":"function(options){return this.prompt(options)}",
            "arguments":[{"value":options}]})).await?;
        if choice["result"]["value"] != true {
            return Ok(());
        }
        let saved =
            tauri::async_runtime::spawn_blocking(move || store::remember(&path, &pin)).await;
        if !matches!(saved, Ok(Ok(()))) {
            eprintln!("Could not remember browser certificate approval");
        }
    }
    call(
        view,
        "Runtime.callFunctionOn",
        json!({"objectId":object,"functionDeclaration":"function(){this.proceed()}"}),
    )
    .await?;
    Ok(())
}
