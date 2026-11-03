use std::{
    io::ErrorKind,
    net::TcpStream,
    time::{Duration, Instant},
};

use crate::remote_websocket::connect_remote_websocket;
use serde::Deserialize;
use serde_json::json;
use tauri::Runtime;
use tungstenite::{stream::MaybeTlsStream, Error as WebSocketError, Message, WebSocket};

use crate::cloud::RemoteControlConfig;
use crate::codex_gui::account_selection::{self, GuiAccountSelection};

mod account_usage;
mod app_update;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    ScreenPower {
        #[serde(rename = "commandId")]
        command_id: String,
        action: crate::platform::screen_power::Action,
    },
    AccountUsage {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
        action: account_usage::UsageAction,
    },
    UpdatePeerOffer(crate::update_peers::Offer),
    UpdatePeerOffers(crate::update_peers::Offers),
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
        #[serde(
            rename = "concurrencyLimit",
            default = "crate::remote_command::default_concurrency_limit"
        )]
        concurrency_limit: usize,
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
    SwitchAggregate {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "aggregateId")]
        aggregate_id: String,
    },
    SwitchGuiAggregate {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "aggregateId")]
        aggregate_id: String,
    },
}

mod reconnect;
pub(crate) use reconnect::start;

fn run_connection<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: RemoteControlConfig,
    update_peers: &mut crate::update_peers::Bridge,
    backoff: &mut crate::remote_websocket::backoff::ReconnectBackoff,
) -> Result<(), String> {
    update_peers.server(&config.websocket_url);
    let (mut socket, _) = connect_remote_websocket(&config.websocket_url)?;
    set_read_timeout(socket.get_mut(), Some(Duration::from_secs(2)))?;
    let remote_commands_enabled = crate::remote_command::host::enabled();
    let mut capabilities = vec![
        "provider-switch",
        "provider-group-switch",
        "restart-codex",
        "gui-model-switch",
        "aggregate-switch",
        "gui-aggregate-switch",
        "app-update",
        "account-usage",
    ];
    if remote_commands_enabled {
        capabilities.push("remote-command");
    }
    #[cfg(windows)]
    capabilities.push("screen-power");
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
                    GuiAccountSelection::Provider(id) => Some(id.clone()),
                    GuiAccountSelection::Aggregate(id) => Some(crate::aggregate_api::active_id(id)),
                    _ => None,
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
    let account_usage = account_usage::UsageHost::new();
    update_peers.connected();
    loop {
        for response in updates
            .responses()
            .into_iter()
            .chain(commands.responses())
            .chain(account_usage.responses())
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
                    ServerMessage::ScreenPower { command_id, action } => {
                        let result = crate::platform::screen_power::set(action)
                            .map_err(|_| "client.deviceScreen.failed".to_owned());
                        send_command_result(&mut socket, command_id, result, "Screen power")?;
                    }
                    ServerMessage::AccountUsage {
                        command_id,
                        account_id,
                        action,
                    } => {
                        account_usage.request(app.clone(), command_id, (account_id, action));
                    }
                    ServerMessage::UpdatePeerOffer(offer) => update_peers.offer(offer),
                    ServerMessage::UpdatePeerOffers(offers) => update_peers.offers(offers),
                    ServerMessage::UpdatePeerUnavailable { request_id } => {
                        update_peers.unavailable(&request_id)
                    }
                    ServerMessage::UpdatePeerCancel { session_id } => {
                        update_peers.cancel(&session_id)
                    }
                    ServerMessage::RemoteCommand {
                        command_id,
                        request,
                        concurrency_limit,
                    } => {
                        if let Some(reply) =
                            commands.request(command_id, request, concurrency_limit)
                        {
                            socket
                                .send(Message::Text(reply.to_string().into()))
                                .map_err(|error| {
                                    format!("Could not send command status: {error}")
                                })?;
                        }
                    }
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
                    ServerMessage::SwitchAggregate {
                        command_id,
                        aggregate_id,
                    } => {
                        let result = crate::aggregate_api::switch_blocking(app, &aggregate_id);
                        send_command_result(&mut socket, command_id, result, "Aggregate switch")?;
                    }
                    ServerMessage::SwitchGuiAggregate {
                        command_id,
                        aggregate_id,
                    } => handle_gui_switch(
                        app,
                        &mut socket,
                        command_id,
                        GuiAccountSelection::Aggregate(aggregate_id),
                    )?,
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
                    ServerMessage::Authenticated { .. } => backoff.reset(),
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
            match next.as_ref() {
                Some(next) => update_peers.server(&next.websocket_url),
                None => update_peers.signed_out(),
            }
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
mod tests;
