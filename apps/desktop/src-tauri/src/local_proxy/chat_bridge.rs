fn forward_chat_bridge(
    method: &Method,
    _url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    if *method != Method::Post {
        return Err("Chat bridge only supports POST requests".to_string());
    }
    let mut responses_body: Value = serde_json::from_slice(&body)
        .map_err(|error| request_error::RequestError::json(request_error::Stage::Request, &error).wire())?;
    if !responses_body.is_object() {
        return Err(request_error::RequestError::new(
            request_error::Stage::Request, request_error::Problem::ObjectRequired).wire());
    }
    bridge_media::validate_responses(&responses_body, true)?;
    validate_anthropic_chat_tools(&responses_body, headers).map_err(|error| error.to_string())?;
    omit_unsupported_provider_service_tier(&mut responses_body, provider);
    let selected_model = selected_provider_model(&responses_body, provider);
    responses_body["model"] = Value::String(selected_model.clone());
    let tool_context = build_codex_tool_context_from_request(&responses_body);
    let continuation_scope = chat_continuation_scope(&provider.id, headers);
    let mut chat_body = responses_to_chat_completions_with_context(
        &responses_body,
        &tool_context,
        continuation_scope.as_ref(),
    );
    chat_bridge_continuation::restore_tool_history(
        continuation_scope.as_ref(),
        responses_body["previous_response_id"].as_str(),
        &mut chat_body,
    )?;
    provider_reasoning::apply(&responses_body, &mut chat_body, provider);
    provider_tool_schema::adapt_chat_tool_schemas(&provider.base_url, &mut chat_body);
    provider_request_options::body(&mut chat_body, provider);
    thought_signatures::prepare_chat_history(&mut chat_body);
    let request_history = if continuation_scope.is_some() {
        chat_body["messages"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let stream = chat_body
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let service_tier = chat_body
        .get("service_tier")
        .and_then(Value::as_str)
        .and_then(normalized_usage_service_tier)
        .or_else(|| Some("default".to_string()));

    let client = http_client()?;
    let upstream_url = if provider_request_options::uses_full_url(provider) {
        provider.base_url.clone()
    } else if provider.balance_platform == Some(ProviderBalancePlatform::DeepSeek) {
        providers::deepseek_endpoint_url(&provider.base_url, "/chat/completions")?.to_string()
    } else {
        build_upstream_url(&provider.base_url, "/chat/completions")
    };
    let response = send_with_timeout_retries(
        || {
            let request = client.post(&upstream_url);
            let request = if provider.api_key.trim().is_empty() {
                request
            } else {
                request.bearer_auth(provider.api_key.trim())
            };
            // JSON supplies a default media type only when the forwarded headers have none.
            provider_request_options::headers(
                apply_forward_headers(request, headers, true),
                provider,
            )
            .json(&chat_body)
        },
        "Chat bridge request failed",
    )?;
    let mut payload = chat_bridge_response::convert(
        response,
        chat_bridge_response::Context {
            stream,
            model: selected_model,
            tools: tool_context,
            scope: continuation_scope,
            request_history,
        },
    )?;
    payload.token_usage_service_tier = service_tier;
    Ok(payload)
}
fn chat_continuation_scope(
    provider_id: &str,
    headers: &[(String, String)],
) -> Option<chat_bridge_continuation::ContinuationScope> {
    proxy_session_id(headers)
        .filter(|session_id| {
            provider_id.len() <= MAX_CONTINUATION_SCOPE_ID_BYTES
                && session_id.len() <= MAX_CONTINUATION_SCOPE_ID_BYTES
        })
        .map(|session_id| {
            chat_bridge_continuation::ContinuationScope::new(provider_id, &session_id)
        })
}

fn selected_provider_model(body: &Value, provider: &ProviderProfile) -> String {
    if aggregate_api::member_account_id(&provider.id).is_some() {
        return provider.model.clone();
    }
    if providers::uses_upstream_official_models(provider) {
        return selected_official_model(body, &provider.model);
    }
    if !provider.model_selection_controlled_by_codex {
        return provider.model.clone();
    }
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| provider.models.iter().any(|allowed| allowed == model))
        .unwrap_or(&provider.model)
        .to_string()
}

fn requested_model(body: &Value) -> Option<&str> {
    body.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

fn selected_official_model(body: &Value, fallback: &str) -> String {
    requested_model(body)
        .unwrap_or_else(|| fallback.trim())
        .to_string()
}

pub(crate) fn enabled_concurrent_account_ids(
    paths: &Paths,
    state: &ManagerStateFile,
) -> Result<Vec<String>, String> {
    let mut account_ids = fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read account directory: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir() && entry.path().join("auth.json").is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|account_id| !state.disabled_account_ids.contains(account_id))
        .filter(|account_id| {
            state.concurrent_account_group.as_ref().is_none_or(|group| {
                load_account_group(&account_group_path(paths, account_id)) == *group
            })
        })
        .collect::<Vec<_>>();
    account_ids.sort();
    Ok(account_ids)
}

fn concurrent_custom_priority_enabled(state: &ManagerStateFile) -> bool {
    state.auto_switch_on_quota_exhaustion && state.custom_auto_switch_priority_enabled
}

fn quota_available_for_concurrent_routing(usage: &UsageSummary, threshold: Option<f64>) -> bool {
    let Some(threshold) = threshold else {
        return reported_quota_windows_have_remaining(usage);
    };
    primary_remaining_quota_score(usage).is_some_and(|remaining| remaining >= threshold)
}

fn available_concurrent_account_ids(
    paths: &Paths,
    state: &ManagerStateFile,
) -> Result<Vec<String>, String> {
    let mut account_ids = enabled_concurrent_account_ids(paths, state)?
        .into_iter()
        .filter(|account_id| {
            let custom_threshold_enabled =
                state.auto_switch_on_quota_exhaustion && state.custom_auto_switch_threshold_enabled;
            let threshold = custom_threshold_enabled.then(|| {
                effective_auto_switch_threshold(
                    load_auto_switch_threshold(&auto_switch_threshold_path(paths, account_id)),
                    state.global_auto_switch_threshold,
                    true,
                )
            });
            quota_available_for_concurrent_routing(
                &load_usage(&usage_path(paths, account_id)),
                threshold,
            )
        })
        .collect();
    concurrent_quota::retain_available(&mut account_ids)?;
    Ok(account_ids)
}

fn preferred_concurrent_account_ids(
    paths: &Paths,
    state: &ManagerStateFile,
    eligible_account_ids: &[String],
) -> Vec<String> {
    if !concurrent_custom_priority_enabled(state) {
        return eligible_account_ids.to_vec();
    }
    // Read each priority once per request, before taking the router lock. A setting
    // change must not produce an empty tier by changing between two file reads.
    let priorities = eligible_account_ids
        .iter()
        .map(|account_id| {
            let priority = load_auto_switch_priority(&auto_switch_priority_path(paths, account_id));
            (account_id, priority)
        })
        .collect::<Vec<_>>();
    let Some(highest_priority) = priorities.iter().map(|(_, priority)| *priority).min() else {
        return Vec::new();
    };
    priorities
        .into_iter()
        .filter(|(_, priority)| *priority == highest_priority)
        .map(|(account_id, _)| account_id.clone())
        .collect()
}

fn concurrent_account_for_session(
    paths: &Paths,
    state: &ManagerStateFile,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let eligible_account_ids = available_concurrent_account_ids(paths, state)?;
    let preferred_account_ids =
        preferred_concurrent_account_ids(paths, state, &eligible_account_ids);
    let no_available_account =
        || "No enabled official account currently meets the configured usage threshold".to_string();
    let Some(session_id) = session_id else {
        return preferred_account_ids
            .first()
            .cloned()
            .map(Some)
            .ok_or_else(no_available_account);
    };
    let account_id = concurrent_account_router()
        .lock()
        .map_err(|_| "Concurrent account router lock is poisoned".to_string())?
        .account_for_session(session_id, &eligible_account_ids, &preferred_account_ids)
        .ok_or_else(no_available_account)?;
    Ok(Some(account_id))
}

fn official_credentials<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    options: OfficialCredentialOptions<'_>,
) -> Result<OfficialProxyCredentials, account_failure::CredentialError> {
    let request_started_at = Instant::now();
    let OfficialCredentialOptions {
        purpose,
        session_id,
        account_id_override,
    } = options;
    let paths = resolve_paths(app)?;
    let (active_account_generation, auto_switch_attempt_generation, state) =
        official_account_snapshot(account_id_override, || {
            auto_switch_coordinator().account_snapshot(|| Ok(read_state(&paths)))
        })?;
    let active_account_id = state.active_account_id.as_deref();
    let concurrent_account_id = if account_id_override.is_none()
        && state.concurrent_account_routing_enabled
        && matches!(purpose, OfficialCredentialPurpose::Default)
    {
        auto_reset::concurrent_account(app, &paths, &state, session_id)?
    } else {
        None
    };
    let selected_account_id = account_id_override
        .or(concurrent_account_id.as_deref())
        .or(active_account_id)
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    diagnostic_event(json!({
        "event": "official_account_selected", "idHash": short_hash_str(selected_account_id),
        "assignment": if account_id_override.is_some() { "override" }
            else if concurrent_account_id.is_some() { "concurrent" } else { "active" }
    }));
    let active_auth = read_json(&managed_auth_path(&paths, selected_account_id))?;
    validate_auth(&active_auth)?;
    let credential_account_id = if account_id_override.is_some() || concurrent_account_id.is_some()
    {
        selected_account_id.to_string()
    } else {
        credential_account_id(&state, &active_auth, purpose)?
    };
    let auto_switch_eligible = credential_is_auto_switch_eligible(
        purpose,
        concurrent_account_id.as_deref(),
        &credential_account_id,
        active_account_id,
    );
    let mut auth = if credential_account_id == selected_account_id {
        active_auth
    } else {
        read_json(&managed_auth_path(&paths, &credential_account_id))?
    };
    validate_auth(&auth)?;
    let (_, _, _, auth_account_id) = account_fields(&auth)?;
    if auth_account_id != credential_account_id {
        return Err(format!(
            "Managed proxy credential does not match the selected account: selected={}, credential={}",
            credential_account_id, auth_account_id
        )
        .into());
    }
    let (email, _, account_id, id) = account_fields(&auth)?;
    if should_mark_proxy_session_concurrent_account(
        &state,
        concurrent_account_id.as_deref(),
        account_id_override,
    ) {
        mark_proxy_session_concurrent_account(session_id, &id, &email);
    }
    let token_usage_account = TokenUsageAccount {
        account_id: id,
        account_email: email,
        active_account_generation,
        auto_switch_attempt_generation,
        auto_switch_eligible,
        concurrent_request_started_at: concurrent_account_id.as_ref().map(|_| request_started_at),
    };
    if matches!(purpose, OfficialCredentialPurpose::ImageGeneration)
        && is_agent_identity_auth(&auth)
    {
        return Err("Select a non-Agent Identity OAuth account for image generation"
            .to_string()
            .into());
    }
    if is_agent_identity_auth(&auth) {
        let expected = auth.clone();
        if agent_identity::ensure_task(client, &mut auth)? {
            persist_or_reload_managed_auth(&paths, &credential_account_id, &expected, &mut auth)?;
        }
        return Ok(OfficialProxyCredentials {
            authentication: OfficialRequestAuthentication::AgentIdentity {
                active_account_id: credential_account_id,
                request_authentication: agent_identity::request_authentication(&auth)?,
                auth,
            },
            token_usage_account,
        });
    }
    if token_expiring(&auth) {
        // An old in-flight request must not overwrite Codex's watched auth.json after a
        // hot switch.  Refresh only the managed credential for the account it started with.
        diagnostic_event(json!({ "event": "official_token_refresh_started",
            "idHash": short_hash_str(&credential_account_id) }));
        refresh_or_reload_managed_auth(client, &paths, &credential_account_id, &mut auth)
            .map_err(|error| account_failure::CredentialError::Refresh {
                error,
                account: token_usage_account.clone(),
            })?;
        diagnostic_event(json!({ "event": "official_token_refresh_finished",
            "idHash": short_hash_str(&credential_account_id) }));
    }
    let access_token = token_string(&auth, "access_token")
        .ok_or_else(|| "auth.json is missing tokens.access_token".to_string())?
        .to_string();
    Ok(OfficialProxyCredentials {
        authentication: OfficialRequestAuthentication::OAuth {
            access_token,
            chatgpt_account_id: account_id,
        },
        token_usage_account,
    })
}

struct OfficialCredentialOptions<'a> {
    purpose: OfficialCredentialPurpose,
    session_id: Option<&'a str>,
    account_id_override: Option<&'a str>,
}

fn official_account_snapshot(
    account_id_override: Option<&str>,
    shared_snapshot: impl FnOnce() -> Result<(u64, u64, ManagerStateFile), String>,
) -> Result<(u64, u64, ManagerStateFile), String> {
    // Explicit credentials belong to their caller's route. They must neither wait for
    // a shared switch nor inherit its automatic-switch or concurrent-session flags.
    if account_id_override.is_some() {
        return Ok((0, 0, ManagerStateFile::default()));
    }
    // Ordinary requests still bind credentials to the shared coordinator generations.
    shared_snapshot()
}

#[cfg(test)]
#[path = "official_credential_isolation_tests.rs"]
mod official_credential_isolation_tests;

fn credential_is_auto_switch_eligible(
    purpose: OfficialCredentialPurpose,
    concurrent_account_id: Option<&str>,
    credential_account_id: &str,
    active_account_id: Option<&str>,
) -> bool {
    purpose == OfficialCredentialPurpose::Default
        && concurrent_account_id.is_none()
        && active_account_id == Some(credential_account_id)
}

fn credential_account_id(
    state: &ManagerStateFile,
    active_auth: &Value,
    purpose: OfficialCredentialPurpose,
) -> Result<String, String> {
    let active_account_id = state
        .active_account_id
        .as_deref()
        .ok_or_else(|| "Select an official account before using the local proxy".to_string())?;
    match purpose {
        OfficialCredentialPurpose::Default => return Ok(active_account_id.to_string()),
        OfficialCredentialPurpose::ImageInput => {
            if let Some(ImageModelTarget::Official { account_id }) = &state.image_input_target {
                return Ok(account_id.clone());
            }
            return Ok(active_account_id.to_string());
        }
        OfficialCredentialPurpose::ImageGeneration => {}
    }
    if let Some(ImageModelTarget::Official { account_id }) = &state.image_output_target {
        return Ok(account_id.clone());
    }
    if (state.concurrent_account_routing_enabled
        || state.active_provider_id.is_some()
        || state.active_provider_group.is_some())
        && state.image_generation_account_id.is_some()
    {
        let account_id = state
            .image_generation_account_id
            .as_ref()
            .cloned()
            .unwrap_or_default();
        return Ok(account_id);
    }
    if !is_agent_identity_auth(active_auth) {
        return Ok(active_account_id.to_string());
    }
    state
        .image_generation_account_id
        .clone()
        .ok_or_else(|| "Select a non-Agent Identity OAuth account for image generation".to_string())
}
