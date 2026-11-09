use super::ServerMessage;

#[test]
fn credential_updates_deserialize_as_notifications_without_switch_commands_or_credentials() {
    let message = serde_json::from_str::<ServerMessage>(
        r#"{"type":"account-auth-updated","accountIds":["account-1","account-2"]}"#,
    )
    .unwrap();
    assert!(
        matches!(message, ServerMessage::AccountAuthUpdated { account_ids }
        if account_ids == ["account-1", "account-2"])
    );
}

#[test]
fn remote_commands_accept_configured_and_legacy_concurrency_limits() {
    for limit in [None, Some(1), Some(8), Some(32)] {
        let mut input = serde_json::json!({"type":"remote-command","commandId":"command-1",
            "request":{"command":"whoami","cwd":null}});
        if let Some(limit) = limit {
            input["concurrencyLimit"] = limit.into();
        }
        let message = serde_json::from_value::<ServerMessage>(input).unwrap();
        assert!(
            matches!(message, ServerMessage::RemoteCommand { concurrency_limit, .. }
            if concurrency_limit == limit.unwrap_or(5) as usize)
        );
    }
}

#[test]
fn parses_monitor_power_without_a_desktop_session() {
    let message = serde_json::from_str::<ServerMessage>(
        r#"{"type":"screen-power","commandId":"screen-1","action":"off"}"#,
    )
    .unwrap();
    assert!(
        matches!(message, ServerMessage::ScreenPower { command_id, action }
        if command_id == "screen-1" && action == crate::platform::screen_power::Action::Off)
    );
    for action in ["toggle", "sleep", "shutdown"] {
        let message =
            serde_json::json!({"type": "screen-power", "commandId": "screen-1", "action": action});
        assert!(serde_json::from_value::<ServerMessage>(message).is_err());
    }
}

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
fn aggregate_commands_keep_gui_and_proxy_targets_separate() {
    let gui = serde_json::from_str::<ServerMessage>(
        r#"{"type":"switch-gui-aggregate","commandId":"gui","aggregateId":"route"}"#,
    )
    .unwrap();
    assert!(
        matches!(gui, ServerMessage::SwitchGuiAggregate { command_id, aggregate_id }
        if command_id == "gui" && aggregate_id == "route")
    );
    let proxy = serde_json::from_str::<ServerMessage>(
        r#"{"type":"switch-aggregate","commandId":"proxy","aggregateId":"route"}"#,
    )
    .unwrap();
    assert!(
        matches!(proxy, ServerMessage::SwitchAggregate { command_id, aggregate_id }
        if command_id == "proxy" && aggregate_id == "route")
    );
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
