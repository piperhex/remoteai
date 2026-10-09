use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_CLOUD_BASE_URL: &str = "https://codex.onepiper.cloud";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSummary {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) group: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) private_details: AccountPrivateDetails,
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    pub(crate) auto_switch_enabled: bool,
    pub(crate) auto_switch_priority: i32,
    pub(crate) auto_switch_threshold: f64,
    pub(crate) local_proxy_compatible: bool,
    pub(crate) direct_switch_compatible: bool,
    pub(crate) agent_identity: bool,
    pub(crate) official: bool,
    pub(crate) metadata_editable: bool,
    pub(crate) usage: UsageSummary,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct AccountPrivateDetails {
    pub(crate) password: String,
    pub(crate) phone_number: String,
    pub(crate) totp_secret: String,
}

impl AccountPrivateDetails {
    pub(crate) fn normalized(mut self) -> Result<Self, String> {
        const MAX_PASSWORD_LENGTH: usize = 1_024;
        const MAX_PHONE_LENGTH: usize = 64;
        const MAX_TOTP_LENGTH: usize = 512;

        if self.password.chars().count() > MAX_PASSWORD_LENGTH {
            return Err("Account password is too long".to_string());
        }
        self.phone_number = self.phone_number.trim().to_string();
        if self.phone_number.chars().count() > MAX_PHONE_LENGTH {
            return Err("Phone number is too long".to_string());
        }
        self.totp_secret = self
            .totp_secret
            .to_uppercase()
            .chars()
            .filter(|character| {
                !character.is_whitespace() && *character != '-' && *character != '='
            })
            .collect();
        let valid_totp = self.totp_secret.is_empty()
            || (self.totp_secret.len() <= MAX_TOTP_LENGTH
                && self
                    .totp_secret
                    .chars()
                    .all(|character| matches!(character, 'A'..='Z' | '2'..='7')));
        valid_totp
            .then_some(self)
            .ok_or_else(|| "2FA key must be a valid Base32 value".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAccountDetailsInput {
    pub(crate) id: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) private_details: AccountPrivateDetails,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummary {
    pub(crate) primary: Option<UsageWindow>,
    pub(crate) secondary: Option<UsageWindow>,
    pub(crate) credits: Option<CreditsSnapshot>,
    pub(crate) api_expires_at: Option<String>,
    pub(crate) plan: Option<String>,
    pub(crate) fetched_at: Option<String>,
    pub(crate) error: Option<String>,
}

/// Purchased Codex credits, independent of the plan's usage windows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreditsSnapshot {
    pub(crate) has_credits: bool,
    pub(crate) unlimited: bool,
    pub(crate) balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    pub(crate) used_percent: f64,
    pub(crate) remaining_percent: f64,
    pub(crate) resets_at: Option<i64>,
    pub(crate) window_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCredit {
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCreditsSummary {
    pub(crate) credits: Vec<ResetCredit>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct ManagerStateFile {
    pub(crate) active_account_id: Option<String>,
    pub(crate) active_provider_id: Option<String>,
    #[serde(default)]
    pub(crate) active_provider_group: Option<String>,
    #[serde(default)]
    pub(crate) auto_switch_provider_id: Option<String>,
    /// Last known executable used by the local ChatGPT/Codex desktop app. This is
    /// intentionally only a local launch hint; it is never synced with accounts.
    #[serde(default)]
    pub(crate) local_codex_path: Option<String>,
    #[serde(default)]
    pub(crate) local_proxy_enabled: bool,
    #[serde(default)]
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    #[serde(default)]
    pub(crate) auto_reset: AutoResetSettings,
    #[serde(skip)]
    pub(crate) auto_reset_settings_changed: bool,
    #[serde(default)]
    pub(crate) concurrent_account_routing_enabled: bool,
    #[serde(default)]
    pub(crate) concurrent_account_group: Option<String>,
    /// Marks an intentional concurrent-routing change for the storage layer.
    /// Ordinary state writes preserve the latest on-disk value instead of
    /// allowing a stale snapshot to overwrite this setting.
    #[serde(skip)]
    pub(crate) concurrent_routing_change_reason: Option<String>,
    #[serde(default)]
    pub(crate) custom_auto_switch_priority_enabled: bool,
    #[serde(default)]
    pub(crate) custom_auto_switch_threshold_enabled: bool,
    #[serde(default)]
    pub(crate) global_auto_switch_threshold: f64,
    #[serde(default)]
    pub(crate) auto_disable_unreachable_accounts: bool,
    #[serde(default)]
    pub(crate) system_prompt_filter_enabled: bool,
    #[serde(default)]
    pub(crate) system_prompt_filter_rules: Vec<SystemPromptRule>,
    #[serde(default)]
    pub(crate) system_prompt_injection_enabled: bool,
    #[serde(default)]
    pub(crate) system_prompt_injection_prompts: Vec<SystemPromptRule>,
    #[serde(default)]
    pub(crate) local_proxy_listen_on_all_interfaces: bool,
    #[serde(default)]
    pub(crate) local_proxy_lan_api_key: Option<String>,
    #[serde(default)]
    pub(crate) local_proxy_lan_api_keys: Vec<LocalProxyLanApiKey>,
    /// Only explicit Key updates may replace authentication settings in an older state snapshot.
    #[serde(skip)]
    pub(crate) local_proxy_lan_api_keys_changed: bool,
    /// Authentication secret for the hosted web control plane. This is kept in
    /// the local state file and is never included in AppSettings responses.
    #[serde(default)]
    pub(crate) web_proxy_lan_api_key: Option<String>,
    #[serde(default)]
    pub(crate) image_generation_account_id: Option<String>,
    #[serde(default)]
    pub(crate) image_input_target: Option<ImageModelTarget>,
    #[serde(default)]
    pub(crate) image_output_target: Option<ImageModelTarget>,
    #[serde(default)]
    pub(crate) local_proxy_openai_auth_account_id: Option<String>,
    #[serde(default)]
    pub(crate) disabled_account_ids: Vec<String>,
    /// Local ownership metadata for Codex threads. The rollout files do not carry
    /// the account that created them, so this map is updated around account switches.
    #[serde(default)]
    pub(crate) conversation_account_ids: BTreeMap<String, String>,
    #[serde(default)]
    pub(crate) observed_conversation_ids: BTreeSet<String>,
    #[serde(default)]
    pub(crate) conversation_ownership_initialized: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemPromptRule {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) name: String,
    pub(crate) text: String,
    pub(crate) enabled: bool,
}

impl<'de> Deserialize<'de> for SystemPromptRule {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Input {
            Legacy(String),
            Structured {
                #[serde(default)]
                name: Option<String>,
                text: String,
                #[serde(default = "default_system_prompt_rule_enabled")]
                enabled: bool,
            },
        }

        match Input::deserialize(deserializer)? {
            Input::Legacy(text) => Ok(Self {
                name: String::new(),
                text,
                enabled: true,
            }),
            Input::Structured {
                name,
                text,
                enabled,
            } => Ok(Self {
                name: name.unwrap_or_default(),
                text,
                enabled,
            }),
        }
    }
}

fn default_system_prompt_rule_enabled() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ImageModelTarget {
    Official { account_id: String },
    Provider { provider_id: String, model: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImageRouteKind {
    Input,
    Output,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    pub(crate) codex_home: String,
    pub(crate) auth_path: String,
    pub(crate) config_path: String,
    pub(crate) account_store: String,
    pub(crate) provider_store: String,
    pub(crate) version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderApiFormat {
    OpenaiResponses,
    OpenaiChat,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderKind {
    #[default]
    Custom,
    #[serde(rename = "openai")]
    OpenAi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderBalancePlatform {
    NewApi,
    Sub2Api,
    DeepSeek,
    CodexSwitch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ReasoningEffort {
    None,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}

pub(crate) type ModelReasoningEfforts = BTreeMap<String, Vec<ReasoningEffort>>;
pub(crate) type ModelContextWindows = BTreeMap<String, u64>;
pub(crate) type ModelApiFormats = BTreeMap<String, ProviderApiFormat>;
