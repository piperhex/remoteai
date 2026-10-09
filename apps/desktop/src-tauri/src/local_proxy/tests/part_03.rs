#[test]
fn configured_provider_image_account_routes_image_requests_to_official() {
    let mut state = ManagerStateFile {
        active_provider_id: Some("third-party".to_string()),
        image_generation_account_id: Some("oauth-account".to_string()),
        ..ManagerStateFile::default()
    };

    assert_eq!(
        image_model_target_for_request(&state, "/v1/images/generations", &[]),
        Some(ImageModelTarget::Official {
            account_id: "oauth-account".to_string(),
        })
    );
    assert!(image_model_target_for_request(&state, "/v1/responses", &[]).is_none());

    state.image_generation_account_id = None;
    assert!(image_model_target_for_request(&state, "/v1/images/generations", &[]).is_none());
}

#[test]
fn image_input_request_uses_the_configured_provider_model() {
    let state = ManagerStateFile {
        image_input_target: Some(ImageModelTarget::Provider {
            provider_id: "vision-provider".to_string(),
            model: "vision-model".to_string(),
        }),
        ..ManagerStateFile::default()
    };
    let body = br#"{"input":[{"type":"input_image","image_url":"data:image/png;base64,AA=="}]}"#;

    assert_eq!(
        image_model_target_for_request(&state, "/v1/responses", body),
        state.image_input_target
    );
    assert!(image_model_target_for_request(&state, "/v1/responses", b"{}").is_none());
}

#[test]
fn image_requests_use_the_configured_oauth_account_for_agent_identity() {
    let mut state = ManagerStateFile {
        active_account_id: Some("agent-identity".to_string()),
        image_generation_account_id: Some("oauth-account".to_string()),
        ..ManagerStateFile::default()
    };
    let agent_identity_auth = json!({
        "auth_mode": "agentIdentity",
        "agent_identity": {}
    });

    assert_eq!(
        credential_account_id(
            &state,
            &agent_identity_auth,
            OfficialCredentialPurpose::Default
        )
        .unwrap(),
        "agent-identity"
    );
    assert_eq!(
        credential_account_id(
            &state,
            &agent_identity_auth,
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap(),
        "oauth-account"
    );

    state.image_generation_account_id = None;
    assert!(credential_account_id(
        &state,
        &agent_identity_auth,
        OfficialCredentialPurpose::ImageGeneration
    )
    .unwrap_err()
    .contains("non-Agent Identity OAuth account"));
}

#[test]
fn image_requests_keep_using_an_active_oauth_account_outside_concurrent_mode() {
    let mut state = ManagerStateFile {
        active_account_id: Some("active-oauth".to_string()),
        image_generation_account_id: Some("备用-oauth".to_string()),
        ..ManagerStateFile::default()
    };

    assert_eq!(
        credential_account_id(
            &state,
            &json!({ "auth_mode": "chatgpt" }),
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap(),
        "active-oauth"
    );

    state.concurrent_account_routing_enabled = true;
    assert_eq!(
        credential_account_id(
            &state,
            &json!({ "auth_mode": "chatgpt" }),
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap(),
        "备用-oauth"
    );

    state.concurrent_account_routing_enabled = false;
    state.active_provider_id = Some("third-party".to_string());
    assert_eq!(
        credential_account_id(
            &state,
            &json!({ "auth_mode": "chatgpt" }),
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap(),
        "备用-oauth"
    );
}

#[test]
fn concurrent_image_requests_fall_back_to_the_active_oauth_account() {
    let state = ManagerStateFile {
        active_account_id: Some("active-oauth".to_string()),
        concurrent_account_routing_enabled: true,
        ..ManagerStateFile::default()
    };

    assert_eq!(
        credential_account_id(
            &state,
            &json!({ "auth_mode": "chatgpt" }),
            OfficialCredentialPurpose::ImageGeneration
        )
        .unwrap(),
        "active-oauth"
    );
}

#[test]
fn fallback_image_credentials_cannot_trigger_a_main_account_switch() {
    let active = TokenUsageAccount {
        account_id: "agent-identity".to_string(),
        account_email: "agent@example.com".to_string(),
        active_account_generation: 0,
        auto_switch_attempt_generation: 0,
        auto_switch_eligible: true,
        concurrent_request_started_at: None,
    };
    let fallback = TokenUsageAccount {
        account_id: "oauth-account".to_string(),
        account_email: "oauth@example.com".to_string(),
        active_account_generation: 0,
        auto_switch_attempt_generation: 0,
        auto_switch_eligible: false,
        concurrent_request_started_at: None,
    };

    assert!(credential_can_trigger_auto_switch(&active));
    assert!(!credential_can_trigger_auto_switch(&fallback));
}

#[test]
fn official_models_endpoint_preserves_client_version_query() {
    let endpoint = upstream_endpoint_for_codex_request("/v1/models?client_version=0.144.0");

    assert_eq!(endpoint, "/v1/models?client_version=0.144.0");
    assert_eq!(
        official_url(&endpoint),
        "https://chatgpt.com/backend-api/codex/models?client_version=0.144.0"
    );
}

#[test]
fn proxy_diagnostic_entry_redacts_response_body_content() {
    let provider = ProviderProfile {
        id: "responses".to_string(),
        kind: ProviderKind::Custom,
        name: "Responses Gateway".to_string(),
        group: String::new(),
        base_url: "https://gateway.example.com/v1".to_string(),
        api_key: "sk-provider-test".to_string(),
        model: "gpt-4.1".to_string(),
        models: vec!["gpt-4.1".to_string()],
        model_reasoning_efforts: Default::default(),
        model_context_windows: Default::default(),
        model_api_formats: Default::default(),
        image_input_models: Vec::new(),
        image_input_models_configured: false,
        context_window: None,
        model_selection_controlled_by_codex: false,
        fast_mode_enabled: false,
        api_format: ProviderApiFormat::OpenaiResponses,
        balance_platform: None,
        balance_query_url: None,
        balance_query_token: None,
        wallet_query_url: None,
        wallet_query_token: None,
        wallet_username: None,
        wallet_password: None,
    };
    let body = serde_json::to_vec(&json!({
        "model": "gpt-4.1",
        "previous_response_id": "resp_secret_cursor",
        "input": "do not log this user prompt",
        "tools": [{ "type": "function", "name": "secret_tool" }],
        "store": true
    }))
    .unwrap();

    let target = ActiveTarget::Provider(Box::new(provider));
    let entry = proxy_diagnostic_entry(
        &Method::Post,
        "/v1/responses",
        &[],
        &body,
        Some(&target),
        ProxyDiagnosticRoute::ProviderResponsesPassthrough,
    );
    let serialized = entry.to_string();

    assert!(serialized.contains("\"previousResponseId\""));
    assert!(serialized.contains("\"hash\""));
    assert!(!serialized.contains("do not log this user prompt"));
    assert!(!serialized.contains("resp_secret_cursor"));
    assert!(!serialized.contains("secret_tool"));
}

#[test]
fn proxy_diagnostic_entry_redacts_non_responses_body_content() {
    let provider = ProviderProfile {
        id: "chat".to_string(),
        kind: ProviderKind::Custom,
        name: "Chat Gateway".to_string(),
        group: String::new(),
        base_url: "https://gateway.example.com/v1".to_string(),
        api_key: "sk-provider-test".to_string(),
        model: "deepseek-chat".to_string(),
        models: vec!["deepseek-chat".to_string()],
        model_reasoning_efforts: Default::default(),
        model_context_windows: Default::default(),
        model_api_formats: Default::default(),
        image_input_models: Vec::new(),
        image_input_models_configured: false,
        context_window: None,
        model_selection_controlled_by_codex: false,
        fast_mode_enabled: false,
        api_format: ProviderApiFormat::OpenaiChat,
        balance_platform: None,
        balance_query_url: None,
        balance_query_token: None,
        wallet_query_url: None,
        wallet_query_token: None,
        wallet_username: None,
        wallet_password: None,
    };
    let body = serde_json::to_vec(&json!({
        "model": "deepseek-chat",
        "messages": [{ "role": "user", "content": "do not log this chat prompt" }],
        "tools": [{ "type": "function", "function": { "name": "secret_tool" } }],
        "stream": true
    }))
    .unwrap();

    let target = ActiveTarget::Provider(Box::new(provider));
    let entry = proxy_diagnostic_entry(
        &Method::Post,
        "/v1/chat/completions",
        &[("Authorization".to_string(), "Bearer sk-secret".to_string())],
        &body,
        Some(&target),
        ProxyDiagnosticRoute::ProviderPassthrough,
    );
    let serialized = entry.to_string();

    assert_eq!(entry["route"].as_str(), Some("provider_passthrough"));
    assert_eq!(entry["requestHeaders"]["authorizationPresent"], true);
    assert!(serialized.contains("\"messages\""));
    assert!(serialized.contains("\"requestBody\""));
    assert!(!serialized.contains("do not log this chat prompt"));
    assert!(!serialized.contains("secret_tool"));
    assert!(!serialized.contains("sk-secret"));
    assert!(entry.get("responses").is_none());
}

#[test]
fn proxy_diagnostic_entry_covers_local_models_route() {
    let target = ActiveTarget::Official {
        model: "gpt-5-codex".to_string(),
    };
    let entry = proxy_diagnostic_entry(
        &Method::Get,
        "/v1/models?probe=secret",
        &[],
        &[],
        Some(&target),
        ProxyDiagnosticRoute::LocalModels,
    );
    let serialized = entry.to_string();

    assert_eq!(entry["route"].as_str(), Some("local_models"));
    assert_eq!(entry["target"]["type"].as_str(), Some("official"));
    assert_eq!(entry["target"]["model"].as_str(), Some("gpt-5-codex"));
    assert_eq!(entry["requestBody"]["json"], false);
    assert_eq!(entry["query"]["present"], true);
    assert!(!serialized.contains("probe=secret"));
    assert!(entry.get("responses").is_none());
}

#[test]
fn official_responses_body_preserves_codex_selected_model() {
    for model in ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] {
        let body = serde_json::to_vec(&json!({
            "model": model,
            "input": "ping",
            "stream": false
        }))
        .unwrap();

        let forwarded =
            official_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), "gpt-5.5");

        assert_eq!(forwarded, body);
    }
}

#[test]
fn official_responses_body_preserves_service_tier() {
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "input": "ping",
        "service_tier": "priority"
    }))
    .unwrap();

    let forwarded =
        official_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), "gpt-5.5");

    assert_eq!(forwarded, body);
}

#[test]
fn proxy_service_tier_override_keeps_model_and_reasoning_unchanged() {
    let mut value = json!({
        "model": "gpt-5.6-sol",
        "reasoning": { "effort": "ultra" },
        "input": "ping"
    });

    apply_proxy_service_tier(&mut value, Some(ProxyServiceTier::Priority));

    assert_eq!(value["model"], "gpt-5.6-sol");
    assert_eq!(value["reasoning"]["effort"], "ultra");
    assert_eq!(value["service_tier"], "priority");
}

#[test]
fn official_responses_body_applies_service_tier_to_existing_request() {
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "reasoning": { "effort": "ultra" },
        "input": "ping"
    }))
    .unwrap();

    let forwarded = official_body_for_upstream_with_tier(
        &Method::Post,
        "/v1/responses",
        body,
        "gpt-5.5",
        Some(ProxyServiceTier::Priority),
    );
    let forwarded: Value = serde_json::from_slice(&forwarded).unwrap();

    assert_eq!(forwarded["model"], "gpt-5.6-sol");
    assert_eq!(forwarded["reasoning"]["effort"], "ultra");
    assert_eq!(forwarded["service_tier"], "priority");
}

#[test]
fn proxy_service_tier_api_accepts_only_supported_values() {
    for (name, tier) in [("default", ProxyServiceTier::Default),
        ("priority", ProxyServiceTier::Priority), ("ultrafast", ProxyServiceTier::Ultrafast)] {
        assert_eq!(serde_json::from_value::<ProxyServiceTier>(json!(name)).unwrap(), tier);
    }
    assert!(serde_json::from_value::<ProxyServiceTier>(json!("invalid")).is_err());
    assert_eq!(
        parse_proxy_service_tier(&json!({ "service_tier": "default" })),
        Ok(ProxyServiceTier::Default)
    );
    assert_eq!(
        parse_proxy_service_tier(&json!({ "service_tier": "priority" })),
        Ok(ProxyServiceTier::Priority)
    );
    assert_eq!(
        parse_proxy_service_tier(&json!({ "service_tier": "fast" })),
        Ok(ProxyServiceTier::Priority)
    );
    assert_eq!(
        parse_proxy_service_tier(&json!({ "service_tier": "ultrafast" })),
        Ok(ProxyServiceTier::Ultrafast)
    );
}

#[test]
fn effective_request_speed_uses_override_then_request_then_standard_default() {
    let priority = br#"{"service_tier":"priority"}"#;
    let standard = br#"{"input":"ping"}"#;
    let invalid = br#"{"service_tier":"turbo"}"#;

    assert_eq!(
        effective_proxy_service_tier(priority, Some(ProxyServiceTier::Default)),
        Some(ProxyServiceTier::Default)
    );
    assert_eq!(
        effective_proxy_service_tier(priority, None),
        Some(ProxyServiceTier::Priority)
    );
    assert_eq!(
        effective_proxy_service_tier(standard, None),
        Some(ProxyServiceTier::Default)
    );
    assert_eq!(effective_proxy_service_tier(invalid, None), None);
}

#[test]
fn proxy_speed_stays_explicit_through_toggles_restarts_and_openai_login() {
    let _guard = GUI_SPEED_TEST_LOCK.lock().unwrap();
    set_proxy_service_tier(ProxyServiceTier::default());
    assert_proxy_speed_matches_forwarded_requests("default");
    assert!(!update_proxy_service_tier_for_openai_auth(Some(
        "oauth-account"
    )));

    assert!(set_proxy_service_tier_by_name("priority"));
    assert_proxy_speed_matches_forwarded_requests("priority");
    assert!(set_proxy_service_tier_by_name("ultrafast"));
    assert_proxy_speed_matches_forwarded_requests("ultrafast");
    assert!(set_proxy_service_tier_by_name("default"));
    assert_proxy_speed_matches_forwarded_requests("default");

    assert!(set_proxy_service_tier_by_name("priority"));
    set_proxy_service_tier(ProxyServiceTier::default());
    assert_proxy_speed_matches_forwarded_requests("default");

    assert!(set_proxy_service_tier_by_name("priority"));
    assert!(update_proxy_service_tier_for_openai_auth(Some(
        "oauth-account"
    )));
    assert_eq!(proxy_service_tier_name(), "default");

    assert!(!update_proxy_service_tier_for_openai_auth(None));
    assert_eq!(proxy_service_tier_name(), "default");
}

#[test]
fn official_responses_body_uses_preferred_model_when_request_has_none() {
    for requested in [None, Some(Value::Null), Some(json!("  "))] {
        let mut value = json!({ "input": "ping", "stream": false });
        if let Some(requested) = requested {
            value["model"] = requested;
        }
        let body = serde_json::to_vec(&value).unwrap();

        let rewritten = official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.5");
        let json: Value = serde_json::from_slice(&rewritten).unwrap();

        assert_eq!(json["model"], "gpt-5.5");
        assert_eq!(json["input"], "ping");
    }
}

#[test]
fn official_responses_body_drops_local_reasoning_items_before_forwarding() {
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "store": false,
        "input": [
            {
                "type": "reasoning",
                "id": "rs_resp_1787577994",
                "summary": [{ "type": "summary_text", "text": "private thought" }]
            },
            {
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": "The weather is sunny." }]
            }
        ]
    }))
    .unwrap();

    let forwarded = official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.6-sol");
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
    let input = parsed["input"].as_array().unwrap();

    assert_eq!(input.len(), 1);
    assert_eq!(input[0]["type"], "message");
    assert!(!forwarded
        .windows(b"rs_resp_".len())
        .any(|window| window == b"rs_resp_"));
}

#[test]
fn official_responses_body_drops_unsupported_output_token_limit() {
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "input": "ping",
        "max_output_tokens": 4096
    }))
    .unwrap();

    let forwarded = official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.6-sol");
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();

    assert!(parsed.get("max_output_tokens").is_none());
    assert_eq!(parsed["model"], "gpt-5.6-sol");
}

#[test]
fn official_responses_body_drops_relay_reasoning_items_before_forwarding() {
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "input": [
            {
                "type": "reasoning",
                "id": "item_1bc6d4061cc75b97950b00fb",
                "summary": [{ "type": "summary_text", "text": "relay thought" }]
            },
            {
                "type": "message",
                "role": "user",
                "content": [{ "type": "input_text", "text": "Continue" }]
            }
        ]
    }))
    .unwrap();

    let forwarded = official_body_for_upstream(&Method::Post, "/v1/responses", body, "gpt-5.6-sol");
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
    let input = parsed["input"].as_array().unwrap();

    assert_eq!(input.len(), 1);
    assert_eq!(input[0]["type"], "message");
    assert!(!forwarded
        .windows(b"item_1bc6d4061cc75b97950b00fb".len())
        .any(|window| window == b"item_1bc6d4061cc75b97950b00fb"));
}

#[test]
fn openai_provider_preserves_codex_selected_model() {
    let provider = openai_provider("https://upstream.example.com/v1".to_string());
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-terra",
        "input": "ping"
    }))
    .unwrap();

    let forwarded =
        provider_body_for_upstream(&Method::Post, "/v1/responses", body.clone(), &provider);

    assert_eq!(forwarded, body);
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();
    assert_eq!(selected_provider_model(&parsed, &provider), "gpt-5.6-terra");
}

#[test]
fn openai_provider_uses_default_model_when_request_has_none() {
    let provider = openai_provider("https://upstream.example.com/v1".to_string());
    let body = serde_json::to_vec(&json!({ "input": "ping" })).unwrap();

    let forwarded = provider_body_for_upstream(&Method::Post, "/v1/responses", body, &provider);
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();

    assert_eq!(parsed["model"], "gpt-5.6-sol");
}

#[test]
fn provider_without_fast_support_omits_service_tier() {
    let mut provider = openai_provider("https://upstream.example.com/v1".to_string());
    provider.fast_mode_enabled = false;
    let body = serde_json::to_vec(&json!({
        "model": "gpt-5.6-sol",
        "input": "ping",
        "service_tier": "priority"
    }))
    .unwrap();

    let forwarded = provider_body_for_upstream(&Method::Post, "/v1/responses", body, &provider);
    let parsed: Value = serde_json::from_slice(&forwarded).unwrap();

    assert!(parsed.get("service_tier").is_none());
}

#[test]
fn openai_provider_models_request_is_forwarded_with_api_key() {
    let catalog = json!({ "models": [
        { "slug": "gpt-5.6-sol", "context_window": 372000 },
        {
            "slug": "gpt-5.6-terra",
            "input_modalities": ["text", "image"],
            "supported_reasoning_levels": [{ "effort": "ultra" }]
        },
        { "slug": "gpt-6-astra", "service_tiers": [{ "id": "priority" }] }
    ] });
    let expected = serde_json::to_vec(&catalog).unwrap();
    let server = Server::http("127.0.0.1:0").unwrap();
    let addr = server.server_addr().to_ip().unwrap();
    let upstream_body = expected.clone();
    let handle = thread::spawn(move || {
        let request = server.recv().unwrap();
        assert_eq!(request.url(), "/v1/models?client_version=0.144.0");
        assert!(request.headers().iter().any(|header| {
            header.field.equiv("Authorization") && header.value.as_str() == "Bearer sk-upstream"
        }));
        request
            .respond(
                Response::from_data(upstream_body)
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
            )
            .unwrap();
    });
    let provider = openai_provider(format!("http://{addr}/v1"));

    let mut payload = forward_provider(
        &Method::Get,
        "/v1/models?client_version=0.144.0",
        &[],
        Vec::new(),
        &provider,
    )
    .unwrap();
    let mut actual = Vec::new();
    match &mut payload.body {
        UpstreamBody::Buffered(body) => actual.extend_from_slice(body),
        UpstreamBody::Streaming(reader) => {
            reader.read_to_end(&mut actual).unwrap();
        }
    }
    handle.join().unwrap();

    let actual: Value = serde_json::from_slice(&actual).unwrap();
    let mut expected: Value = serde_json::from_slice(&expected).unwrap();
    for model in expected["models"].as_array_mut().unwrap() {
        model["use_responses_lite"] = json!(false);
    }
    assert_eq!(actual, expected);
}

#[test]
fn openai_provider_request_without_api_key_omits_authorization() {
    let catalog = json!({ "models": [] });
    let expected = serde_json::to_vec(&catalog).unwrap();
    let server = Server::http("127.0.0.1:0").unwrap();
    let addr = server.server_addr().to_ip().unwrap();
    let upstream_body = expected.clone();
    let handle = thread::spawn(move || {
        let request = server.recv().unwrap();
        assert!(!request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Authorization")));
        request
            .respond(
                Response::from_data(upstream_body)
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
            )
            .unwrap();
    });
    let mut provider = openai_provider(format!("http://{addr}/v1"));
    provider.api_key.clear();

    let mut payload =
        forward_provider(&Method::Get, "/v1/models", &[], Vec::new(), &provider).unwrap();
    let mut actual = Vec::new();
    match &mut payload.body {
        UpstreamBody::Buffered(body) => actual.extend_from_slice(body),
        UpstreamBody::Streaming(reader) => {
            reader.read_to_end(&mut actual).unwrap();
        }
    }
    handle.join().unwrap();

    assert_eq!(actual, expected);
}
