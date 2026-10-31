#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    /// Kept for clients released before multi-home settings were introduced.
    #[serde(default)]
    pub(crate) codex_home: Option<String>,
    #[serde(default)]
    pub(crate) codex_homes: Vec<CodexHomeEntry>,
    #[serde(default = "default_launch_at_startup")]
    pub(crate) launch_at_startup: bool,
    #[serde(default = "default_close_to_tray")]
    pub(crate) close_to_tray: bool,
    #[serde(default = "default_non_proxy_enhancements_enabled")]
    pub(crate) non_proxy_enhancements_enabled: bool,
    #[serde(default = "default_floating_bubble_enabled")]
    pub(crate) floating_bubble_enabled: bool,
    #[serde(default)]
    pub(crate) quota_display_all_accounts: bool,
    #[serde(default)]
    pub(crate) quota_window_sync_enabled: bool,
    #[serde(default)]
    pub(crate) pet_dock_enabled: bool,
    #[serde(default)]
    pub(crate) pet_dock_show_labels: bool,
    #[serde(default)]
    pub(crate) theme_color: Option<String>,
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default = "default_privacy_mode")]
    pub(crate) privacy_mode: bool,
    #[serde(default)]
    pub(crate) hide_account_notes: bool,
    #[serde(default)]
    pub(crate) bubble_reset_display: BubbleResetDisplay,
    #[serde(default)]
    pub(crate) bubble_style: BubbleStyle,
    #[serde(default)]
    pub(crate) bubble_x: Option<f64>,
    #[serde(default)]
    pub(crate) bubble_y: Option<f64>,
    #[serde(default = "default_cloud_base_url")]
    pub(crate) cloud_base_url: Option<String>,
    #[serde(default)]
    pub(crate) show_custom_cloud_server: bool,
    #[serde(default)]
    pub(crate) cloud_user_email: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_id: Option<String>,
    #[serde(default)]
    pub(crate) cloud_last_sync_at: Option<String>,
    #[serde(default)]
    pub(crate) cloud_session_expired: bool,
    #[serde(default = "default_token_usage_weeks")]
    pub(crate) token_usage_weeks: u16,
    #[serde(default = "default_token_usage_refresh_seconds")]
    pub(crate) token_usage_refresh_seconds: u64,
    #[serde(default = "default_codex_usage_summary_enabled")]
    pub(crate) codex_usage_summary_enabled: bool,
    #[serde(default = "default_auto_disable_status_codes")]
    pub(crate) auto_disable_status_codes: Vec<u16>,
    #[serde(default = "default_upstream_429_retry_timeout_seconds")]
    pub(crate) upstream_429_retry_timeout_seconds: u64,
    #[serde(default)]
    pub(crate) sse_idle_timeout: SseIdleTimeoutSettings,
    #[serde(default)]
    pub(crate) sse_idle_timeout_migrated: bool,
    #[serde(default)]
    pub(crate) proxy_transport: ProxyTransportSettings,
    #[serde(default)]
    pub(crate) response_header_timeout: ResponseHeaderTimeoutSettings,
    /// Records the one-time migration from the legacy five-minute retry default.
    #[serde(default)]
    pub(crate) upstream_429_retry_timeout_migrated: bool,
    #[serde(default)]
    pub(crate) show_usage_network_errors: bool,
    #[serde(default = "default_gpt_5_6_sol_context_window")]
    pub(crate) gpt_5_6_sol_context_window: u64,
    #[serde(default)]
    pub(crate) official_model_context_windows: std::collections::BTreeMap<String, u64>,
    #[serde(default)]
    pub(crate) web_proxy_port: Option<u16>,
    #[serde(default)]
    pub(crate) web_proxy_listen_on_all_interfaces: bool,
    #[serde(default)]
    pub(crate) network_proxy: NetworkProxySettings,
    #[serde(default)]
    pub(crate) provider_groups: Vec<String>,
    #[serde(default)]
    pub(crate) account_groups: Vec<String>,
    #[serde(default)]
    pub(crate) claude_code_write_target: ClaudeCodeWriteTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) third_party_app_write: Option<ThirdPartyAppWriteSettings>,
    #[serde(default)]
    pub(crate) last_started_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexHomeEntry {
    pub(crate) id: String,
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClaudeCodeWriteTarget {
    All,
    #[default]
    Codex,
    ClaudeCode,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThirdPartyAppWriteTargets {
    #[serde(default)]
    pub(crate) claude_code: bool,
    #[serde(default)]
    pub(crate) open_code: bool,
    #[serde(default)]
    pub(crate) open_claw: bool,
    #[serde(default)]
    pub(crate) hermes_agent: bool,
    #[serde(default)]
    pub(crate) trae: bool,
    #[serde(default)]
    pub(crate) work_buddy: bool,
    #[serde(default)]
    pub(crate) z_code: bool,
    #[serde(default)]
    pub(crate) deep_seek_harness: bool,
    #[serde(default)]
    pub(crate) open_viking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThirdPartyAppWriteSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default = "default_write_codex")]
    pub(crate) write_codex: bool,
    #[serde(default)]
    pub(crate) apps: ThirdPartyAppWriteTargets,
    #[serde(default = "default_claude_subagent_model")]
    pub(crate) claude_subagent_model: String,
}

pub(crate) const DEFAULT_CLAUDE_SUBAGENT_MODEL: &str = "sol";

impl Default for ThirdPartyAppWriteSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            write_codex: true,
            apps: ThirdPartyAppWriteTargets::default(),
            claude_subagent_model: default_claude_subagent_model(),
        }
    }
}

impl From<ClaudeCodeWriteTarget> for ThirdPartyAppWriteSettings {
    fn from(target: ClaudeCodeWriteTarget) -> Self {
        let writes_claude = target != ClaudeCodeWriteTarget::Codex;
        Self {
            enabled: writes_claude,
            write_codex: target != ClaudeCodeWriteTarget::ClaudeCode,
            apps: ThirdPartyAppWriteTargets {
                claude_code: writes_claude,
                ..ThirdPartyAppWriteTargets::default()
            },
            claude_subagent_model: default_claude_subagent_model(),
        }
    }
}

fn default_write_codex() -> bool {
    true
}

fn default_claude_subagent_model() -> String {
    DEFAULT_CLAUDE_SUBAGENT_MODEL.to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkProxySettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) proxy_url: String,
    #[serde(default)]
    pub(crate) proxy_port: Option<u16>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleResetDisplay {
    #[default]
    Countdown,
    ResetAt,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleStyle {
    #[default]
    Classic,
    Glass,
}

fn default_privacy_mode() -> bool {
    true
}

fn default_launch_at_startup() -> bool {
    true
}

fn default_floating_bubble_enabled() -> bool {
    true
}

fn default_cloud_base_url() -> Option<String> {
    Some(DEFAULT_CLOUD_BASE_URL.to_string())
}

pub(crate) const MIN_TOKEN_USAGE_WEEKS: u16 = 1;
pub(crate) const MAX_TOKEN_USAGE_WEEKS: u16 = 52;
pub(crate) const MIN_TOKEN_USAGE_REFRESH_SECONDS: u64 = 1;
pub(crate) const MAX_TOKEN_USAGE_REFRESH_SECONDS: u64 = 3_600;
pub(crate) const DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 60;
pub(crate) const MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 1;
pub(crate) const MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 3_600;
pub(crate) const DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 272_000;
pub(crate) const MAX_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 1_050_000;
pub(crate) const MIN_GPT_5_6_SOL_CONTEXT_WINDOW: u64 = 1_000;

fn default_token_usage_weeks() -> u16 {
    10
}

fn default_token_usage_refresh_seconds() -> u64 {
    60
}

fn default_codex_usage_summary_enabled() -> bool {
    true
}

fn default_gpt_5_6_sol_context_window() -> u64 {
    DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW
}

fn default_close_to_tray() -> bool {
    true
}

fn default_non_proxy_enhancements_enabled() -> bool {
    true
}

fn default_auto_disable_status_codes() -> Vec<u16> {
    vec![401, 402, 403, 429]
}

fn default_upstream_429_retry_timeout_seconds() -> u64 {
    DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_home: None,
            codex_homes: Vec::new(),
            launch_at_startup: default_launch_at_startup(),
            close_to_tray: default_close_to_tray(),
            non_proxy_enhancements_enabled: default_non_proxy_enhancements_enabled(),
            floating_bubble_enabled: default_floating_bubble_enabled(),
            quota_display_all_accounts: false,
            quota_window_sync_enabled: false,
            pet_dock_enabled: false,
            pet_dock_show_labels: false,
            theme_color: None,
            language: None,
            privacy_mode: default_privacy_mode(),
            hide_account_notes: false,
            bubble_reset_display: BubbleResetDisplay::default(),
            bubble_style: BubbleStyle::default(),
            bubble_x: None,
            bubble_y: None,
            cloud_base_url: default_cloud_base_url(),
            show_custom_cloud_server: false,
            cloud_user_email: None,
            cloud_user_id: None,
            cloud_last_sync_at: None,
            cloud_session_expired: false,
            token_usage_weeks: default_token_usage_weeks(),
            token_usage_refresh_seconds: default_token_usage_refresh_seconds(),
            codex_usage_summary_enabled: default_codex_usage_summary_enabled(),
            auto_disable_status_codes: default_auto_disable_status_codes(),
            upstream_429_retry_timeout_seconds: default_upstream_429_retry_timeout_seconds(),
            upstream_429_retry_timeout_migrated: false,
            sse_idle_timeout: SseIdleTimeoutSettings::default(),
            sse_idle_timeout_migrated: false,
            proxy_transport: ProxyTransportSettings::default(),
            response_header_timeout: ResponseHeaderTimeoutSettings::default(),
            show_usage_network_errors: false,
            gpt_5_6_sol_context_window: default_gpt_5_6_sol_context_window(),
            official_model_context_windows: std::collections::BTreeMap::new(),
            web_proxy_port: None,
            web_proxy_listen_on_all_interfaces: false,
            network_proxy: NetworkProxySettings::default(),
            provider_groups: Vec::new(),
            account_groups: Vec::new(),
            claude_code_write_target: ClaudeCodeWriteTarget::default(),
            third_party_app_write: None,
            last_started_version: None,
        }
    }
}

#[derive(Serialize, Clone)]
pub(crate) struct LoginStatus {
    pub(crate) ok: bool,
    pub(crate) message: String,
    #[serde(rename = "accountId")]
    pub(crate) account_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct LoginStart {
    pub(crate) url: String,
    pub(crate) embedded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthState {
    pub(crate) enabled: bool,
    pub(crate) base_url: Option<String>,
    pub(crate) authenticated: bool,
    pub(crate) user_email: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) last_sync_at: Option<String>,
    pub(crate) session_expired: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncResult {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
}
