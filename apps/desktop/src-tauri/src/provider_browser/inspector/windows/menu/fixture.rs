//! Test-only controller scaling and geometry for the isolated native browser fixture.
use tauri::{Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::{
    core::Interface,
    Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::ClientToScreen,
    },
};

#[tauri::command]
pub(crate) async fn context_menu_fixture(
    webview: Webview,
    scale: f64,
    zoom: f64,
) -> Result<serde_json::Value, String> {
    if webview.label() != "main" || !(1.0..=2.0).contains(&scale) || !(0.5..=2.0).contains(&zoom) {
        return Err("invalid fixture request".into());
    }
    let child = webview
        .app_handle()
        .webviews()
        .into_values()
        .find(|view| view.label().starts_with("provider-browser-"))
        .ok_or("fixture browser unavailable")?;
    let (send, receive) = tokio::sync::oneshot::channel();
    child
        .with_webview(move |view| {
            let result =
                configure(&view.controller(), scale, zoom).map_err(|error| error.to_string());
            if send.send(result).is_err() {
                eprintln!("Context menu fixture receiver closed");
            }
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

fn configure(
    controller: &ICoreWebView2Controller,
    scale: f64,
    zoom: f64,
) -> windows::core::Result<serde_json::Value> {
    // SAFETY: The fixture callback runs on the controller apartment and only alters its test view.
    unsafe {
        let controller3 = controller.cast::<ICoreWebView2Controller3>()?;
        controller3.SetShouldDetectMonitorScaleChanges(false)?;
        controller3.SetRasterizationScale(scale)?;
        controller.SetZoomFactor(zoom)?;
        let mut parent = HWND::default();
        controller.ParentWindow(&mut parent)?;
        let mut origin = POINT::default();
        if !ClientToScreen(parent, &mut origin).as_bool() {
            return Err(windows::core::Error::from_win32());
        }
        let mut bounds = RECT::default();
        controller.Bounds(&mut bounds)?;
        Ok(
            serde_json::json!({"x":origin.x + bounds.left,"y":origin.y + bounds.top,
            "width":bounds.right-bounds.left,"height":bounds.bottom-bounds.top,"scale":scale,"zoom":zoom}),
        )
    }
}
