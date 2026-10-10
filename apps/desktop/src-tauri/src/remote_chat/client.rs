use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::Deserialize;
use tauri::{ipc::Channel, AppHandle, Manager, Webview};
use tokio::sync::{mpsc, watch, Mutex};

use super::{bridge::Batch, config::Config, protocol::Outgoing, ClientRequest};

const UNAVAILABLE: &str = "连接暂时不可用，请重新选择电脑。";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    pub(super) client_id: String,
    pub(super) device_id: String,
    pub(super) identity: crate::cloud::GuiCloudIdentity,
    pub(super) public_key: String,
    pub(super) resume: Option<ResumeRequest>,
    pub(super) assistance_id: Option<String>,
    pub(super) bulk_events: Option<tauri::ipc::JavaScriptChannelId>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteAckRequest {
    client_id: String,
    sequence: u64,
    #[serde(default)]
    bulk: bool,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResumeRequest {
    pub(super) session_id: String,
    resume_token: String,
}

impl OpenRequest {
    pub(super) fn matches(&self, config: &Config) -> bool {
        let expected_url = format!(
            "{}/device-chat",
            self.identity.base_url.trim_end_matches('/')
        )
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
        config.websocket_url == expected_url
            && config.device_id != self.device_id
            && serde_json::to_string(&self.identity.user_id)
                .is_ok_and(|owner| owner == config.owner)
    }

    pub(super) fn validate(&self) -> bool {
        uuid::Uuid::parse_str(&self.client_id).is_ok()
            && !self.device_id.is_empty()
            && self.device_id.len() <= 160
            && self.public_key.len() == 64
            && self.public_key.bytes().all(|b| b.is_ascii_hexdigit())
            && self
                .assistance_id
                .as_ref()
                .is_none_or(|id| uuid::Uuid::parse_str(id).is_ok())
            && self.resume.as_ref().is_none_or(|resume| {
                !resume.session_id.is_empty()
                    && resume.session_id.len() <= 160
                    && !resume.resume_token.is_empty()
                    && resume.resume_token.len() <= 512
            })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSendRequest {
    client_id: String,
    message: Outgoing,
}

pub(super) enum ClientCommand {
    Send(Outgoing),
    Ack(u64),
    BulkAck(u64),
}

struct ConnectionHandle {
    cancelled: Arc<AtomicBool>,
    commands: mpsc::Sender<ClientCommand>,
}

#[derive(Default)]
struct ClientConnections(HashMap<String, ConnectionHandle>);

impl ClientConnections {
    fn insert(&mut self, client_id: String, handle: ConnectionHandle) {
        if let Some(previous) = self.0.insert(client_id, handle) {
            previous.cancelled.store(true, Ordering::Release);
        }
    }

    fn sender(&self, client_id: &str) -> Option<mpsc::Sender<ClientCommand>> {
        self.0.get(client_id).map(|handle| handle.commands.clone())
    }

    fn close(&mut self, client_id: &str) {
        if let Some(previous) = self.0.remove(client_id) {
            previous.cancelled.store(true, Ordering::Release);
        }
    }

    fn finished(&mut self, client_id: &str, cancelled: &Arc<AtomicBool>) {
        // An old worker must never remove a replacement with the same client ID.
        if self
            .0
            .get(client_id)
            .is_some_and(|handle| Arc::ptr_eq(&handle.cancelled, cancelled))
        {
            self.0.remove(client_id);
        }
    }
}

struct ClientState {
    connections: Arc<Mutex<ClientConnections>>,
    configs: watch::Receiver<Option<Config>>,
}

fn require_main(window: &Webview) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在主窗口选择电脑。".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn gui_remote_open(
    app: AppHandle,
    window: Webview,
    request: OpenRequest,
    events: Channel<Batch>,
) -> Result<(), String> {
    require_main(&window)?;
    if !request.validate() {
        return Err(UNAVAILABLE.into());
    }
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    let (commands, receiver) = mpsc::channel(super::protocol::COMMAND_LIMIT);
    let cancelled = Arc::new(AtomicBool::new(false));
    let handle = ConnectionHandle {
        cancelled: cancelled.clone(),
        commands,
    };
    let client_id = request.client_id.clone();
    let connections = state.connections.clone();
    connections.lock().await.insert(client_id.clone(), handle);
    let configs = state.configs.clone();
    let tcp_authority = app.state::<super::tcp::State>().client_authority.clone();
    let bulk_events = request.bulk_events.as_ref().map(|id| id.channel_on(window));
    std::thread::spawn(move || {
        super::client_runtime::run(
            request,
            events,
            receiver,
            super::client_runtime::Lifecycle {
                configs,
                cancelled: cancelled.clone(),
                tcp_authority,
                bulk_events,
            },
        );
        connections.blocking_lock().finished(&client_id, &cancelled);
    });
    Ok(())
}

async fn submit(app: AppHandle, client_id: String, command: ClientCommand) -> Result<(), String> {
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    let sender = state.connections.lock().await.sender(&client_id);
    if let Some(sender) = sender {
        sender.send(command).await.map_err(|_| UNAVAILABLE)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn gui_remote_send(
    app: AppHandle,
    window: Webview,
    request: RemoteSendRequest,
) -> Result<(), String> {
    require_main(&window)?;
    request.message.validate().map_err(|_| UNAVAILABLE)?;
    submit(app, request.client_id, ClientCommand::Send(request.message)).await
}

#[tauri::command]
pub(crate) async fn gui_remote_ack(
    app: AppHandle,
    window: Webview,
    request: RemoteAckRequest,
) -> Result<(), String> {
    require_main(&window)?;
    let command = if request.bulk {
        ClientCommand::BulkAck(request.sequence)
    } else {
        ClientCommand::Ack(request.sequence)
    };
    submit(app, request.client_id, command).await
}

#[tauri::command]
pub(crate) async fn gui_remote_close(
    app: AppHandle,
    window: Webview,
    request: ClientRequest,
) -> Result<(), String> {
    require_main(&window)?;
    let state = app.try_state::<ClientState>().ok_or(UNAVAILABLE)?;
    state.connections.lock().await.close(&request.client_id);
    Ok(())
}

pub(super) fn start<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    configs: watch::Receiver<Option<Config>>,
) {
    app.manage(ClientState {
        connections: Arc::default(),
        configs,
    });
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
