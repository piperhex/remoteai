use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudUserResponse {
    pub(super) id: String,
    pub(super) email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudTokenResponse {
    pub(super) access_token: String,
    pub(super) refresh_token: String,
    pub(super) user: Option<CloudUserResponse>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedCloudLogin {
    pub(super) email: String,
    pub(super) password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum CloudSyncWarning {
    AggregateSyncUnavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthenticationResult {
    pub(super) state: CloudAuthState,
    pub(super) password_saved: bool,
    pub(super) credential_storage_updated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) sync_warning: Option<CloudSyncWarning>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudAccountsResponse {
    pub(super) accounts: Vec<CloudAccountPayload>,
    #[serde(default)]
    pub(super) deleted_account_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeletedCloudAccountsResponse {
    pub(super) accounts: Vec<DeletedCloudAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeletedCloudProvidersResponse {
    pub(super) providers: Vec<DeletedCloudProvider>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudProvidersResponse {
    pub(super) providers: Vec<ProviderSyncPayload>,
    #[serde(default)]
    pub(super) deleted_provider_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudTotpEntry {
    pub(super) id: String,
    pub(super) issuer: String,
    pub(super) account_name: String,
    pub(super) secret: String,
    pub(super) algorithm: String,
    pub(super) digits: u8,
    pub(super) period: u16,
    pub(super) created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) updated_at: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudTotpTombstone {
    pub(super) id: String,
    pub(super) deleted_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudTotpVault {
    pub(super) entries: Vec<CloudTotpEntry>,
    #[serde(default)]
    pub(super) tombstones: Vec<CloudTotpTombstone>,
    pub(super) modified_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAnnouncement {
    pub(super) content: String,
    #[serde(default)]
    pub(super) content_zh: String,
    #[serde(default)]
    pub(super) content_en: String,
    #[serde(default)]
    pub(super) link: String,
    pub(super) enabled: bool,
    pub(super) text_color: String,
    pub(super) background_color: String,
    #[serde(default)]
    pub(super) dark_text_color: Option<String>,
    #[serde(default)]
    pub(super) dark_background_color: Option<String>,
    #[serde(default = "default_announcement_scroll_duration_seconds")]
    pub(super) scroll_duration_seconds: u16,
    pub(super) updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudNotification {
    pub(super) id: String,
    pub(super) title_zh: String,
    pub(super) title_en: String,
    pub(super) content_zh: String,
    pub(super) content_en: String,
    #[serde(default)]
    pub(super) link: String,
    #[serde(default)]
    pub(super) link_label_zh: String,
    #[serde(default)]
    pub(super) link_label_en: String,
    pub(super) enabled: bool,
    pub(super) published_at: String,
    pub(super) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudFaq {
    pub(super) id: String,
    pub(super) question_zh: String,
    pub(super) question_en: String,
    pub(super) answer_zh: String,
    pub(super) answer_en: String,
    pub(super) enabled: bool,
    pub(super) sort_order: i32,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudCurrencyRate {
    pub(super) code: String,
    pub(super) name: String,
    pub(super) rate: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudCurrencyRates {
    pub(super) currencies: Vec<CloudCurrencyRate>,
    pub(super) updated_at: Option<String>,
}

pub(super) fn default_announcement_scroll_duration_seconds() -> u16 {
    22
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FeedbackImageInput {
    pub(super) file_name: String,
    pub(super) mime_type: String,
    pub(super) data_base64: String,
}

#[derive(Debug)]
pub(super) struct FeedbackImage {
    pub(super) file_name: String,
    pub(super) mime_type: String,
    pub(super) data: Vec<u8>,
}

pub(super) const MAX_FEEDBACK_IMAGE_BYTES: usize = 5 * 1024 * 1024;
pub(super) const MAX_FEEDBACK_IMAGES: usize = 4;
pub(super) const FEEDBACK_IMAGE_MIME_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];
pub(super) const CLOUD_LOGIN_KEYRING_USER: &str = "default";
pub(super) const CLOUD_SESSION_EXPIRED_EVENT: &str = "cloud-session-expired";

// Serialize credential snapshots and local commits only. Network I/O must never
// hold this lock; each session has a separate refresh coordinator.
pub(super) static CLOUD_CREDENTIALS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
pub(super) const ACTIVITY_REPORT_USAGE_INTERVAL: usize = 50;
pub(super) static USAGE_SINCE_LAST_ACTIVITY_REPORT: AtomicUsize = AtomicUsize::new(0);

pub(super) fn lock_cloud_credentials() -> Result<MutexGuard<'static, ()>, String> {
    CLOUD_CREDENTIALS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Cloud credentials lock is unavailable".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstallationState {
    pub(super) device_id: String,
    pub(super) platform: String,
    #[serde(default)]
    pub(super) reported_at: Option<String>,
    #[serde(default)]
    pub(super) reported_version: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CloudCredentials {
    #[serde(skip)]
    pub(super) session: Option<credential_session::SessionSnapshot>,
    pub(super) access_token: Option<String>,
    pub(super) refresh_token: Option<String>,
    #[serde(default)]
    pub(super) device_id: Option<String>,
}

pub(crate) struct RemoteControlConfig {
    pub(crate) gui_selection: crate::codex_gui::account_selection::GuiAccountSelection,
    pub(crate) websocket_url: String,
    pub(crate) access_token: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) platform: String,
    pub(crate) app_version: String,
    pub(crate) active_account_id: Option<String>,
    pub(crate) openai_auth_account_id: Option<String>,
    pub(crate) active_provider_id: Option<String>,
    pub(crate) active_provider_group: Option<String>,
    pub(crate) local_proxy_running: bool,
}
