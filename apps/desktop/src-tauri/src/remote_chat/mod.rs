//! Native ownership of chat registration, credentials, heartbeats and reconnection.
//! Rust owns WebRTC and packet cryptography; the main WebView coordinates application messages.

mod auth_renewal;
mod bridge;
pub(crate) mod bulk;
mod client;
mod client_bulk;
pub(crate) mod client_bulk_send;
mod client_runtime;
mod config;
pub(crate) mod crypto;
pub(crate) mod host_health;
pub(crate) mod identity;
mod ipc_ack;
pub(crate) mod packet_codec;
mod protocol;
mod renderer_recovery;
mod runtime;
mod sessions;
pub(crate) mod tcp;
pub(crate) mod traversal;
mod wire;

#[cfg(test)]
mod tests;

use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle, Manager, Webview};
use tokio::sync::mpsc;

use bridge::Batch;
pub(crate) use client::*;
use protocol::{Command, Outgoing};

struct ChatState(mpsc::Sender<Command>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientRequest {
    client_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachRequest {
    client_id: String,
    bulk_events: Option<tauri::ipc::JavaScriptChannelId>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendRequest {
    client_id: String,
    generation: u64,
    message: Outgoing,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AckRequest {
    client_id: String,
    sequence: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconnectRequest {
    client_id: String,
    generation: u64,
    reset: bool,
}

async fn submit(app: AppHandle, window: Webview, command: Command) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口连接手机聊天。".into());
    }
    let state = app
        .try_state::<ChatState>()
        .ok_or("暂时无法连接手机聊天，请重启应用后重试。")?;
    state
        .0
        .send(command)
        .await
        .map_err(|_| "手机聊天已断开，请重启应用后重试。".into())
}

/// The frontend supplies a callback, never a cloud URL or credential.
#[tauri::command]
pub(crate) async fn remote_chat_attach(
    app: AppHandle,
    window: Webview,
    request: AttachRequest,
    events: Channel<Batch>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&request.client_id).map_err(|_| "请重新打开主窗口后重试。")?;
    let bulk = request
        .bulk_events
        .as_ref()
        .map(|id| id.channel_on(window.clone()));
    submit(
        app,
        window,
        Command::Attach {
            bulk,
            client_id: request.client_id,
            deliver: Box::new(move |batch| events.send(batch).is_ok()),
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn remote_chat_send(
    app: AppHandle,
    window: Webview,
    mut request: SendRequest,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口连接手机聊天。".into());
    }
    request
        .message
        .validate()
        .map_err(|_| "聊天消息无法发送，请重新连接后重试。")?;
    if let Outgoing::Signal {
        session_id,
        payload,
    } = &mut request.message
    {
        if payload["kind"] == "key" {
            let id = session_id.clone();
            let mut signed = payload.clone();
            *payload = tauri::async_runtime::spawn_blocking(move || {
                identity::sign(&id, &mut signed)?;
                Ok::<_, String>(signed)
            })
            .await
            .map_err(|_| "电脑身份未能读取，请重试。".to_string())??;
        }
    }
    submit(app, window, Command::Send(request)).await
}

#[tauri::command]
pub(crate) async fn remote_chat_ack(
    app: AppHandle,
    window: Webview,
    request: AckRequest,
) -> Result<(), String> {
    submit(app, window, Command::Ack(request)).await
}

#[tauri::command]
pub(crate) async fn remote_chat_bulk_ack(
    app: AppHandle,
    window: Webview,
    request: AckRequest,
) -> Result<(), String> {
    submit(app, window, Command::BulkAck(request)).await
}

#[tauri::command]
pub(crate) async fn remote_chat_reconnect(
    app: AppHandle,
    window: Webview,
    request: ReconnectRequest,
) -> Result<(), String> {
    submit(app, window, Command::Reconnect(request)).await
}

#[tauri::command]
pub(crate) async fn remote_chat_detach(
    app: AppHandle,
    window: Webview,
    request: ClientRequest,
) -> Result<(), String> {
    submit(app, window, Command::Detach(request.client_id)).await
}

pub(crate) fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    crate::port_mapping::start(&app);
    let (sender, receiver) = mpsc::channel(protocol::COMMAND_LIMIT);
    app.manage(ChatState(sender));
    let upload_policy =
        std::sync::Arc::clone(&app.state::<crate::codex_gui::GuiState>().upload_policy);
    let configs = config::watch(app.clone());
    client::start(&app, configs.clone());
    let tcp = tcp::State::default();
    let authority = tcp.authority.clone();
    app.manage(tcp);
    app.manage(traversal::State::default());
    let health = host_health::start(app);
    let runtime = runtime::Runtime::new(upload_policy, authority, health);
    std::thread::spawn(move || runtime::run(runtime, receiver, configs));
}
