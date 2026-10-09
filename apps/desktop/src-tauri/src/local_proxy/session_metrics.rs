use super::{ProxySessionLatencySummary, ProxySessionRequestState, ProxySessionState};

const RECENT_SESSION_LIMIT: usize = 5;
const MAX_THREAD_ID_BYTES: usize = 200;

#[derive(Debug, thiserror::Error)]
enum MetricsError {
    #[error("请选择有效的对话后重试。")]
    InvalidThread,
    #[error("暂时无法读取对话速度，请稍后重试。")]
    Unavailable,
}

/// Reads only the requested conversation on a worker, including for remote GUI clients.
#[tauri::command]
pub(crate) async fn get_proxy_session_metrics(
    thread_id: String,
) -> Result<ProxySessionLatencySummary, String> {
    validate_thread_id(&thread_id).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_session_metrics(&thread_id))
        .await
        .map_err(|_| MetricsError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

fn validate_thread_id(thread_id: &str) -> Result<(), MetricsError> {
    if thread_id.is_empty()
        || thread_id.len() > MAX_THREAD_ID_BYTES
        || thread_id
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(MetricsError::InvalidThread);
    }
    Ok(())
}

fn read_session_metrics(thread_id: &str) -> Result<ProxySessionLatencySummary, MetricsError> {
    let sessions = super::proxy_sessions()
        .lock()
        .map_err(|_| MetricsError::Unavailable)?;
    Ok(summarize_recent_sessions(
        sessions.get(thread_id).into_iter(),
    ))
}

/// Summarizes retained requests from the most recently active conversations.
pub(super) fn summarize_recent_sessions<'a>(
    sessions: impl Iterator<Item = &'a ProxySessionState>,
) -> ProxySessionLatencySummary {
    let mut sessions = sessions.collect::<Vec<_>>();
    sessions.sort_unstable_by(|left, right| {
        right
            .last_seen_at
            .cmp(&left.last_seen_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut summary = ProxySessionLatencySummary::default();
    for request in sessions
        .into_iter()
        .take(RECENT_SESSION_LIMIT)
        .flat_map(|session| &session.requests)
    {
        add_request(&mut summary, request);
    }
    summary
}

fn add_request(summary: &mut ProxySessionLatencySummary, request: &ProxySessionRequestState) {
    let Some(first_response_time_ms) = request.first_response_time_ms else {
        return;
    };
    summary.total_first_response_time_ms = summary
        .total_first_response_time_ms
        .saturating_add(first_response_time_ms);
    summary.request_count = summary.request_count.saturating_add(1);
    if request.interrupted {
        return;
    }
    let Some(output_tokens) = request.usage.as_ref().and_then(|usage| usage.output_tokens) else {
        return;
    };
    let Some(output_time_ms) = request
        .response_time_ms
        .and_then(|elapsed| elapsed.checked_sub(first_response_time_ms))
        .filter(|duration| *duration > 0)
    else {
        return;
    };
    // Sum durations before dividing so a short response cannot dominate the average TPS.
    summary.total_output_tokens = summary.total_output_tokens.saturating_add(output_tokens);
    summary.total_output_time_ms = summary.total_output_time_ms.saturating_add(output_time_ms);
    summary.output_request_count = summary.output_request_count.saturating_add(1);
}

#[cfg(test)]
#[path = "tests/session_metrics.rs"]
mod tests;
