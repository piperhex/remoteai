#[tauri::command]
pub(crate) async fn list_proxy_session_requests<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    session_id: String,
) -> Result<Vec<ProxySessionRequestSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_proxy_history(&app)?;
        list_proxy_session_requests_blocking(&session_id)
    })
    .await
    .map_err(|error| format!("Proxy session request list task failed: {error}"))?
}

fn list_proxy_session_requests_blocking(
    session_id: &str,
) -> Result<Vec<ProxySessionRequestSummary>, String> {
    check_proxy_history_save()?;
    let requests = proxy_history_requests(session_id)?;
    Ok(requests
        .iter()
        .map(|request| ProxySessionRequestSummary {
            id: request.id,
            started_at: request.started_at,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            service_tier: request.service_tier.map(|tier| tier.as_str().to_string()),
            conversation: request.conversation.clone(),
            response: request.response.clone(),
            input_attachments: request.input_attachments.clone(),
            output_attachments: request.output_attachments.clone(),
            response_truncated: request.response_truncated,
            interrupted: request.interrupted,
            first_response_time_ms: request.first_response_time_ms,
            first_token_time_ms: request.first_token_time_ms,
            response_time_ms: request.response_time_ms,
            total_tokens: request.usage.as_ref().and_then(token_usage_total),
            input_tokens: request.usage.as_ref().and_then(|usage| usage.input_tokens),
            output_tokens: request.usage.as_ref().and_then(|usage| usage.output_tokens),
            reasoning_tokens: request
                .usage
                .as_ref()
                .and_then(|usage| usage.reasoning_tokens),
            cached_tokens: request.usage.as_ref().and_then(|usage| usage.cached_tokens),
        })
        .collect())
}
