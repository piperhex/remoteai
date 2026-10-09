macro_rules! log_proxy_error {
    ($($argument:tt)*) => {{
        let message = format!($($argument)*);
        crate::error_logs::record_proxy_error(&message, None);
        $crate::local_proxy::diagnostic_event(serde_json::json!({
            "event": "proxy_error",
            "error": crate::error_logs::sanitize_diagnostic_message(&message)
        }));
        eprintln!("{message}");
    }};
}

mod anthropic_reasoning;
mod anthropic_stream;
pub(crate) mod auto_reset;
pub(crate) mod concurrent_quota;
pub(crate) mod endpoints;
mod error_capture;
mod error_messages;
mod gui_auto_switch;
pub(crate) mod gui_context;
mod gui_forwarding;
mod gui_routing;
pub(crate) mod gui_runtime;
pub(crate) mod gui_speed;
pub(crate) mod gui_system_prompts;
pub(crate) mod lan_keys;
mod lan_usage_capture;
mod official_input;
mod quota_detection;
mod quota_sse;
mod responses_lite;
mod session_metrics;
mod session_titles;
pub(crate) mod sse_idle_timeout;
mod sse_transport;
mod upstream_transport;
mod usage_service_tier;

pub(crate) use lan_keys::{
    delete_local_proxy_lan_api_key, list_local_proxy_lan_api_keys, save_local_proxy_lan_api_key,
};
use quota_detection::is_official_quota_exhaustion;
use usage_service_tier::UsageServiceTier;

include!("constants.rs");
include!("types.rs");
include!("state_core.rs");
include!("state_sessions.rs");
include!("request_session.rs");
include!("history_store.rs");
include!("history_attachments.rs");
include!("history.rs");
include!("history_commands.rs");
include!("conversation_attachments.rs");
include!("conversation_multipart.rs");
include!("conversation_response.rs");
include!("commands_status.rs");
include!("commands_speed.rs");
include!("lifecycle.rs");
include!("settings.rs");
include!("lan_settings.rs");
include!("auto_reset_commands.rs");
include!("system_prompt_filter.rs");
include!("system_prompt_injection.rs");
include!("server.rs");
include!("request_routing.rs");
include!("active_forwarding.rs");
include!("retry.rs");
include!("routing_auto.rs");
include!("routing_target.rs");
include!("image_account_pool.rs");
include!("capture.rs");
include!("usage_values.rs");
include!("usage_context.rs");
include!("service_tier.rs");
include!("diagnostics_helpers.rs");
include!("diagnostics_trace.rs");
include!("diagnostics_stream.rs");
include!("diagnostics_export.rs");
include!("token_usage.rs");
include!("token_usage_db.rs");
include!("token_usage_breakdown.rs");
include!("forwarding.rs");
include!("provider_api_fallback.rs");
include!("anthropic_bridge.rs");
include!("anthropic_forwarding.rs");
include!("anthropic_request.rs");
include!("anthropic_options.rs");
include!("models.rs");
include!("chat_bridge.rs");
include!("auth_http.rs");
include!("error_logging.rs");
include!("conversion.rs");
include!("chat_input.rs");
include!("chat_media.rs");
include!("chat_request_options.rs");
include!("tools.rs");
include!("streaming.rs");
include!("streaming_tools.rs");
include!("chat_stream_status.rs");
include!("sse.rs");

#[cfg(test)]
mod tests {
    include!("tests/diagnostics.rs");
    include!("tests/chat_protocol_conversion.rs");
    include!("tests/anthropic_protocol_conversion.rs");
    include!("tests/anthropic_protocol_http.rs");
    include!("tests/part_01.rs");
    include!("tests/part_02.rs");
    include!("tests/part_03.rs");
    include!("tests/official_input.rs");
    include!("tests/part_04.rs");
    include!("tests/part_05.rs");
    include!("tests/part_06.rs");
    include!("tests/part_07.rs");
    include!("tests/chat_bridge_headers.rs");
    include!("tests/provider_api_fallback.rs");
    include!("tests/part_08.rs");
    include!("tests/part_09.rs");
    include!("tests/conversation.rs");
    include!("tests/image_usage.rs");
    include!("tests/history.rs");
    include!("tests/service_tier_db.rs");
    include!("tests/service_tier_capture.rs");
    include!("tests/provider_service_tier.rs");
    include!("tests/responses_lite.rs");
    include!("tests/token_usage_breakdown.rs");
    include!("tests/token_usage_responsiveness.rs");
    include!("tests/token_usage_capture.rs");
    include!("tests/official_service_tier_capture.rs");
    include!("tests/auto_switch_retry.rs");
    include!("tests/retry_target.rs");
    include!("tests/auto_switch_responsiveness.rs");
    include!("tests/anthropic_sessions.rs");
    include!("tests/chat_stream_status.rs");
    include!("tests/http_streaming.rs");
    include!("tests/lan_http.rs");
    include!("tests/gui_routing.rs");
    include!("tests/gui_runtime.rs");
    include!("tests/gui_system_prompts.rs");
    include!("tests/gui_home_isolation.rs");
    include!("tests/gui_transport_error.rs");
    include!("tests/error_logging.rs");
}
