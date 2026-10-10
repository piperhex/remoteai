use std::{
    io::ErrorKind,
    net::TcpStream,
    thread,
    time::{Duration, Instant},
};

use crate::remote_websocket::connect_remote_websocket;
use serde::Deserialize;
use serde_json::json;
use tauri::Runtime;
use tungstenite::{stream::MaybeTlsStream, Error as WebSocketError, Message, WebSocket};

use crate::cloud::RemoteControlConfig;
use crate::codex_gui::account_selection::{self, GuiAccountSelection};

mod app_update;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    UpdatePeerOffer(crate::update_peers::Offer),
    UpdatePeerUnavailable {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    UpdatePeerCancel {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    RemoteCommand {
        #[serde(rename = "commandId")]
        command_id: String,
        request: crate::remote_command::CommandRequest,
    },
    RemoteCommandCancel {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    AppUpdate {
        #[serde(rename = "commandId")]
        command_id: String,
        action: app_update::UpdateAction,
        version: Option<String>,
    },
    Authenticated {
        #[serde(rename = "deviceId")]
        _device_id: String,
    },
    SwitchAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
    SetOpenaiAuthAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
    SwitchProvider {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "providerId")]
        provider_id: String,
    },
    SwitchProviderGroup {
        #[serde(rename = "commandId")]
        command_id: String,
        group: String,
    },
    RestartCodex {
        #[serde(rename = "commandId")]
        command_id: String,
    },
    SwitchGuiAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
    SwitchGuiProvider {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "providerId")]
        provider_id: String,
    },
}

pub(crate) fn start<R: Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || loop {
        match crate::cloud::remote_control_config(&app) {
            Ok(Some(config)) => {
                if let Err(error) = run_connection(&app, config) {
                    eprintln!("remote account control disconnected: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("remote account control is unavailable: {error}"),
        }
        thread::sleep(Duration::from_secs(3));
    });
}

fn run_connection<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: RemoteControlConfig,
) -> Result<(), String> {
    let (mut socket, _) = connect_remote_websocket(&config.websocket_url)?;
    set_read_timeout(socket.get_mut(), Some(Duration::from_secs(2)))?;
    let remote_commands_enabled = crate::remote_command::host::enabled();
    let mut capabilities = vec![
        "provider-switch",
        "provider-group-switch",
        "restart-codex",
        "gui-model-switch",
        "app-update",
    ];
    if remote_commands_enabled {
        capabilities.push("remote-command");
    }
    socket
        .send(Message::Text(
            json!({
                "type": "authenticate",
                "accessToken": config.access_token,
                "deviceId": config.device_id,
                "name": config.device_name,
                "platform": config.platform,
                "appVersion": config.app_version,
                "activeAccountId": config.active_account_id,
                "openaiAuthAccountId": config.openai_auth_account_id,
                "activeProviderId": config.active_provider_id,
                "activeProviderGroup": config.active_provider_group,
                "localProxyRunning": config.local_proxy_running,
                "guiAccountId": match &config.gui_selection {
                    GuiAccountSelection::Account(id) => Some(id), _ => None,
                },
                "guiProviderId": match &config.gui_selection {
                    GuiAccountSelection::Provider(id) => Some(id), _ => None,
                },
                "capabilities": capabilities,
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("Could not authenticate WebSocket: {error}"))?;

    let mut last_ping = Instant::now();
    let mut updates = app_update::UpdateBridge::new(app);
    let mut commands = crate::remote_command::host::CommandHost::new();
    let mut update_peers = crate::update_peers::Bridge::new(app);
    loop {
        for response in updates
            .responses()
            .into_iter()
            .chain(commands.responses())
            .chain(update_peers.responses())
        {
            socket
                .send(Message::Text(response.to_string().into()))
                .map_err(|error| format!("Could not send update status: {error}"))?;
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message = serde_json::from_str::<ServerMessage>(&text)
                    .map_err(|error| format!("Invalid remote control message: {error}"))?;
                match message {
                    ServerMessage::UpdatePeerOffer(offer) => update_peers.offer(offer),
                    ServerMessage::UpdatePeerUnavailable { request_id } => {
                        update_peers.unavailable(&request_id)
                    }
                    ServerMessage::UpdatePeerCancel { session_id } => {
                        update_peers.cancel(&session_id)
                    }
                    ServerMessage::RemoteCommand {
                        command_id,
                        request,
                    } => commands.request(command_id, request),
                    ServerMessage::RemoteCommandCancel { command_id } => {
                        commands.cancel(&command_id)
                    }
                    ServerMessage::AppUpdate {
                        command_id,
                        action,
                        version,
                    } => {
                        updates.request(command_id, action, version)?;
                    }
                    ServerMessage::SwitchAccount {
                        command_id,
                        account_id,
                    } => handle_switch(app, &mut socket, command_id, account_id)?,
                    ServerMessage::SetOpenaiAuthAccount {
                        command_id,
                        account_id,
                    } => handle_openai_auth_switch(app, &mut socket, command_id, account_id)?,
                    ServerMessage::SwitchProvider {
                        command_id,
                        provider_id,
                    } => handle_provider_switch(app, &mut socket, command_id, provider_id)?,
                    ServerMessage::SwitchProviderGroup { command_id, group } => {
                        handle_provider_group_switch(app, &mut socket, command_id, group)?
                    }
                    ServerMessage::RestartCodex { command_id } => {
                        handle_codex_restart(app, &mut socket, command_id)?
                    }
                    ServerMessage::SwitchGuiAccount {
                        command_id,
                        account_id,
                    } => handle_gui_switch(
                        app,
                        &mut socket,
                        command_id,
                        GuiAccountSelection::Account(account_id),
                    )?,
                    ServerMessage::SwitchGuiProvider {
                        command_id,
                        provider_id,
                    } => handle_gui_switch(
                        app,
                        &mut socket,
                        command_id,
                        GuiAccountSelection::Provider(provider_id),
                    )?,
                    ServerMessage::Authenticated { .. } => {}
                }
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| format!("Could not answer WebSocket ping: {error}"))?;
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(error.to_string()),
        }

        if last_ping.elapsed() >= Duration::from_secs(20) {
            socket
                .send(Message::Ping(Vec::new().into()))
                .map_err(|error| format!("Could not send WebSocket ping: {error}"))?;
            last_ping = Instant::now();
        }

        let next = crate::cloud::remote_control_config(app)?;
        if remote_commands_enabled != crate::remote_command::host::enabled()
            || next.as_ref().is_none_or(|next| {
                next.websocket_url != config.websocket_url
                    || next.access_token != config.access_token
                    || next.active_account_id != config.active_account_id
                    || next.openai_auth_account_id != config.openai_auth_account_id
                    || next.active_provider_id != config.active_provider_id
                    || next.active_provider_group != config.active_provider_group
                    || next.local_proxy_running != config.local_proxy_running
                    || next.gui_selection != config.gui_selection
            })
        {
            let _ = socket.close(None);
            return Ok(());
        }
    }
}

fn handle_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    account_id: String,
) -> Result<(), String> {
    let result =
        crate::commands::switch_account_and_restart_chatgpt_blocking(app.clone(), account_id);
    send_command_result(socket, command_id, result, "account switch")
}

fn handle_openai_auth_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    account_id: String,
) -> Result<(), String> {
    let result = crate::local_proxy::set_local_proxy_openai_auth_account_blocking(
        app.clone(),
        Some(account_id),
    )
    .map(|_| ());
    send_command_result(socket, command_id, result, "OpenAI login account switch")
}

fn handle_provider_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    provider_id: String,
) -> Result<(), String> {
    let result = crate::providers::switch_provider_blocking(app.clone(), provider_id);
    send_command_result(socket, command_id, result, "Provider switch")
}

fn handle_provider_group_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    group: String,
) -> Result<(), String> {
    let result = crate::providers::switch_provider_group_blocking(app.clone(), group);
    send_command_result(socket, command_id, result, "Provider group switch")
}

fn handle_codex_restart<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
) -> Result<(), String> {
    let result = crate::commands::restart_chatgpt_blocking(app.clone());
    send_command_result(socket, command_id, result, "Codex restart")
}

fn handle_gui_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    selection: GuiAccountSelection,
) -> Result<(), String> {
    let result = account_selection::switch_account(app, selection)
        .map(|_| ())
        .map_err(|error| error.to_string());
    send_command_result(socket, command_id, result, "GUI model switch")
}

fn send_command_result(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    result: Result<(), String>,
    context: &str,
) -> Result<(), String> {
    let response = match result {
        Ok(()) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": true,
        }),
        Err(error) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": false,
            "error": error,
        }),
    };
    socket
        .send(Message::Text(response.to_string().into()))
        .map_err(|error| format!("Could not send {context} result: {error}"))
}

fn set_read_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Option<Duration>,
) -> Result<(), String> {
    match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(timeout),
        _ => Ok(()),
    }
    .map_err(|error| format!("Could not configure WebSocket timeout: {error}"))
}

#[cfg(test)]
mod tests {
    use super::ServerMessage;

    #[test]
    fn parses_gui_switches_separately_from_proxy_commands() {
        let account = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-gui-account","commandId":"gui-1","accountId":"account-1"}"#,
        )
        .unwrap();
        assert!(
            matches!(account, ServerMessage::SwitchGuiAccount { command_id, account_id }
            if command_id == "gui-1" && account_id == "account-1")
        );
        let provider = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-gui-provider","commandId":"gui-2","providerId":"provider-1"}"#,
        )
        .unwrap();
        assert!(
            matches!(provider, ServerMessage::SwitchGuiProvider { command_id, provider_id }
            if command_id == "gui-2" && provider_id == "provider-1")
        );
        assert!(serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-gui-account","commandId":"gui-3","providerId":"wrong"}"#,
        )
        .is_err());
    }

    #[test]
    fn parses_provider_switch_and_restart_commands() {
        let provider = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-provider","commandId":"command-1","providerId":"provider-1"}"#,
        )
        .expect("provider command should deserialize");
        assert!(matches!(
            provider,
            ServerMessage::SwitchProvider {
                command_id,
                provider_id,
            } if command_id == "command-1" && provider_id == "provider-1"
        ));

        let group = serde_json::from_str::<ServerMessage>(
            r#"{"type":"switch-provider-group","commandId":"command-g","group":"Work"}"#,
        )
        .expect("Provider group command should deserialize");
        assert!(matches!(
            group,
            ServerMessage::SwitchProviderGroup { command_id, group }
                if command_id == "command-g" && group == "Work"
        ));

        let restart = serde_json::from_str::<ServerMessage>(
            r#"{"type":"restart-codex","commandId":"command-2"}"#,
        )
        .expect("restart command should deserialize");
        assert!(matches!(
            restart,
            ServerMessage::RestartCodex { command_id } if command_id == "command-2"
        ));
    }
}
