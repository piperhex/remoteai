//! Desktop-owned WebRTC. Frontend adapters exchange signaling/control, never run an RTC stack.
#[cfg(test)]
mod benchmark;
pub(crate) mod bulk;
mod channel;
mod chat;
#[cfg(test)]
mod diagnostics;
#[cfg(test)]
mod encrypted_benchmark;
mod events;
#[cfg(test)]
mod harness;
mod hevc;
#[cfg(test)]
mod hevc_fixture;
mod media;
#[cfg(test)]
mod media_fixture;
mod model;
mod peer;
mod state;
pub(crate) mod stream;
#[cfg(test)]
mod tests;
pub(crate) mod turn_transport;

pub(crate) use model::Error;
use model::{Configuration, Event, Operation};
use serde::Deserialize;
pub(crate) use state::State;
use tauri::Webview;

fn authorize(window: &Webview) -> std::result::Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("PATH_UNAVAILABLE".into())
    }
}

pub(crate) fn boundary(error: Error) -> String {
    match error {
        Error::Invalid => "INVALID_RECORD",
        Error::Capacity => "RESOURCE_LIMIT",
        Error::Closed | Error::Transport => "PATH_UNAVAILABLE",
    }
    .into()
}

#[tauri::command]
pub(crate) async fn native_rtc_open(
    window: Webview,
    state: tauri::State<'_, State>,
    configuration: Configuration,
) -> std::result::Result<String, String> {
    authorize(&window)?;
    state
        .open(window.label(), configuration)
        .await
        .map_err(boundary)
}

#[tauri::command]
pub(crate) async fn native_rtc_operation(
    window: Webview,
    state: tauri::State<'_, State>,
    request: Request,
) -> std::result::Result<serde_json::Value, String> {
    authorize(&window)?;
    let peer = state
        .get(window.label(), &request.id)
        .await
        .map_err(boundary)?;
    peer.operate(request.operation).await.map_err(boundary)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    id: String,
    operation: Operation,
}

#[tauri::command]
pub(crate) async fn native_rtc_poll(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> std::result::Result<Vec<Event>, String> {
    authorize(&window)?;
    let peer = state.get(window.label(), &id).await.map_err(boundary)?;
    peer.poll().await.map_err(boundary)
}

#[tauri::command]
pub(crate) async fn native_rtc_receive(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> std::result::Result<tauri::ipc::Response, String> {
    authorize(&window)?;
    let peer = state.get(window.label(), &id).await.map_err(boundary)?;
    peer.receive_binary()
        .await
        .map(tauri::ipc::Response::new)
        .map_err(boundary)
}

#[tauri::command]
pub(crate) async fn native_rtc_send(
    window: Webview,
    state: tauri::State<'_, State>,
    request: tauri::ipc::Request<'_>,
) -> std::result::Result<(), String> {
    authorize(&window)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(boundary(Error::Invalid));
    };
    if bytes.len() > model::MAX_MESSAGE_BYTES {
        return Err(boundary(Error::Capacity));
    }
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| boundary(Error::Invalid))
    };
    let peer = state
        .get(window.label(), header("x-rtc-peer")?)
        .await
        .map_err(boundary)?;
    let channel = peer
        .channel(header("x-rtc-channel")?)
        .await
        .map_err(boundary)?;
    let text = header("x-rtc-type")? == "text";
    channel
        .send(bytes.clone().into(), text)
        .await
        .map_err(boundary)
}

#[tauri::command]
pub(crate) async fn native_rtc_close(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> std::result::Result<(), String> {
    authorize(&window)?;
    state.close(window.label(), &id).await.map_err(boundary)
}
