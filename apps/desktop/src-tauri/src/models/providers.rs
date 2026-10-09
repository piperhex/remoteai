#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderProfile {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
    #[serde(default)]
    pub(crate) model_reasoning_efforts: ModelReasoningEfforts,
    #[serde(default)]
    pub(crate) model_context_windows: ModelContextWindows,
    #[serde(default)]
    pub(crate) model_api_formats: ModelApiFormats,
    #[serde(default)]
    pub(crate) image_input_models: Vec<String>,
    #[serde(default)]
    pub(crate) image_input_models_configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) context_window: Option<u64>,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: bool,
    #[serde(default)]
    pub(crate) fast_mode_enabled: bool,
    pub(crate) api_format: ProviderApiFormat,
    #[serde(default)]
    pub(crate) balance_platform: Option<ProviderBalancePlatform>,
    #[serde(default)]
    pub(crate) balance_query_url: Option<String>,
    #[serde(default)]
    pub(crate) balance_query_token: Option<String>,
    #[serde(default)]
    pub(crate) wallet_query_url: Option<String>,
    #[serde(default)]
    pub(crate) wallet_query_token: Option<String>,
    #[serde(default)]
    pub(crate) wallet_username: Option<String>,
    #[serde(default)]
    pub(crate) wallet_password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSummary {
    pub(crate) id: String,
    pub(crate) kind: ProviderKind,
    pub(crate) name: String,
    pub(crate) group: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) models: Vec<String>,
    pub(crate) model_reasoning_efforts: ModelReasoningEfforts,
    pub(crate) model_context_windows: ModelContextWindows,
    pub(crate) model_api_formats: ModelApiFormats,
    pub(crate) image_input_models: Vec<String>,
    pub(crate) image_input_models_configured: bool,
    pub(crate) context_window: Option<u64>,
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) fast_mode_enabled: bool,
    pub(crate) api_format: ProviderApiFormat,
    pub(crate) active: bool,
    pub(crate) auto_switch_enabled: bool,
    pub(crate) has_api_key: bool,
    pub(crate) supports_direct_switch: bool,
    pub(crate) balance_platform: Option<ProviderBalancePlatform>,
    pub(crate) balance_query_url: Option<String>,
    pub(crate) balance_query_uses_api_key: bool,
    pub(crate) has_balance_query_token: bool,
    pub(crate) wallet_query_url: Option<String>,
    pub(crate) has_wallet_query_token: bool,
    pub(crate) wallet_username: Option<String>,
    pub(crate) has_wallet_login_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderBalance {
    pub(crate) api_amount: Option<f64>,
    pub(crate) api_unit: String,
    pub(crate) api_unlimited: bool,
    pub(crate) wallet_amount: Option<f64>,
    pub(crate) wallet_unit: String,
    pub(crate) wallet_error: Option<String>,
    pub(crate) balance_items: Vec<ProviderBalanceItem>,
    pub(crate) queried_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderBalanceItem {
    pub(crate) amount: f64,
    pub(crate) unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProxyStatus {
    pub(crate) running: bool,
    pub(crate) service_tier: crate::local_proxy::ProxyServiceTier,
    pub(crate) fast_mode_enabled: bool,
    pub(crate) fast_mode_available: bool,
    pub(crate) address: String,
    pub(crate) port: u16,
    pub(crate) base_url: String,
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    pub(crate) concurrent_account_routing_enabled: bool,
    pub(crate) concurrent_account_group: Option<String>,
    pub(crate) custom_auto_switch_priority_enabled: bool,
    #[serde(default)]
    pub(crate) custom_auto_switch_threshold_enabled: bool,
    #[serde(default)]
    pub(crate) global_auto_switch_threshold: f64,
    pub(crate) auto_disable_unreachable_accounts: bool,
    pub(crate) system_prompt_filter_enabled: bool,
    pub(crate) system_prompt_filter_rules: Vec<crate::models::SystemPromptRule>,
    #[serde(default)]
    pub(crate) system_prompt_injection_enabled: bool,
    pub(crate) system_prompt_injection_prompts: Vec<crate::models::SystemPromptRule>,
    pub(crate) listen_on_all_interfaces: bool,
    pub(crate) has_lan_api_key: bool,
    pub(crate) image_generation_account_id: Option<String>,
    pub(crate) image_input_target: Option<ImageModelTarget>,
    pub(crate) image_output_target: Option<ImageModelTarget>,
    pub(crate) openai_auth_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionSummary {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    pub(crate) client: String,
    pub(crate) remote_address: Option<String>,
    pub(crate) connected_at: u64,
    pub(crate) last_seen_at: u64,
    pub(crate) active_requests: u64,
    pub(crate) request_count: u64,
    pub(crate) provider: Option<String>,
    pub(crate) concurrent_routed: bool,
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) context_tokens: Option<u64>,
    pub(crate) model_context_window: Option<u64>,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionRequestSummary {
    pub(crate) id: u64,
    pub(crate) started_at: u64,
    pub(crate) model: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) service_tier: Option<String>,
    pub(crate) conversation: Option<String>,
    pub(crate) response: Option<String>,
    pub(crate) input_attachments: Vec<ProxyConversationAttachment>,
    pub(crate) output_attachments: Vec<ProxyConversationAttachment>,
    pub(crate) response_truncated: bool,
    pub(crate) interrupted: bool,
    pub(crate) first_response_time_ms: Option<u64>,
    pub(crate) response_time_ms: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
    pub(crate) cached_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxySessionLatencySummary {
    pub(crate) total_first_response_time_ms: u64,
    pub(crate) request_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsageEntry {
    pub(crate) id: String,
    pub(crate) ts: u64,
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) service_tier: Option<String>,
    pub(crate) duration_ms: Option<u64>,
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
    pub(crate) cached_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    #[serde(default)]
    pub(crate) model_context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountTokenUsageTotals {
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderTokenUsageTotals {
    pub(crate) provider: String,
    pub(crate) provider_id: Option<String>,
    pub(crate) today_tokens: u64,
    pub(crate) total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyTokenUsage {
    pub(crate) date: String,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxyConversationAttachment {
    pub(crate) id: String,
}
