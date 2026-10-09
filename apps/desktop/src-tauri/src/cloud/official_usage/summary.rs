use super::*;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuotaEstimate {
    capacity_usd: Option<f64>,
    remaining_usd: Option<f64>,
    consumed_usd: f64,
    decline_percent: f64,
    start_percent: Option<f64>,
    remaining_percent: Option<f64>,
    start_ts: i64,
    end_ts: i64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceTotal {
    device_id: String,
    device_name: String,
    tokens: u64,
    cost_usd: f64,
    updated_at: i64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountTotal {
    account_id: String,
    account_label: String,
    tokens: u64,
    cost_usd: f64,
    remaining_usd: Option<f64>,
    primary: Option<QuotaEstimate>,
    secondary: Option<QuotaEstimate>,
    devices: Vec<DeviceTotal>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SummaryStatus {
    Ready,
    SignedOut,
    Unavailable,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummary {
    accounts: Vec<AccountTotal>,
    status: SummaryStatus,
    updated_at: i64,
}

fn load_summary<R: Runtime>(
    app: &tauri::AppHandle<R>,
    start_ts: i64,
) -> Result<UsageSummary, UsageError> {
    let _guard = lock_cloud_credentials().map_err(|_| UsageError::Unavailable)?;
    let mut settings = read_app_settings(app).map_err(|_| UsageError::Unavailable)?;
    let mut credentials = read_cloud_credentials(app);
    if !cloud_state(&settings, &credentials).authenticated {
        return Ok(UsageSummary {
            accounts: Vec::new(),
            status: SummaryStatus::SignedOut,
            updated_at: Utc::now().timestamp(),
        });
    }
    let client = api_client().map_err(|_| UsageError::Unavailable)?;
    let summary = cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        Method::GET,
        &format!("/official-usage/summary?startTs={start_ts}"),
        None,
    )
    .map_err(|_| UsageError::Unavailable)?
    .error_for_status()
    .map_err(|_| UsageError::Unavailable)?
    .json()
    .map_err(|_| UsageError::Unavailable)?;
    write_app_settings(app, &settings).map_err(|_| UsageError::Unavailable)?;
    write_cloud_credentials(app, &credentials).map_err(|_| UsageError::Unavailable)?;
    Ok(summary)
}

/// Only aggregated server results cross IPC; no other device's records are downloaded.
#[tauri::command]
pub(crate) async fn get_official_usage_summary<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: i64,
) -> Result<UsageSummary, String> {
    if start_ts < 0 || start_ts > Utc::now().timestamp() {
        return Err("请选择有效的统计时间范围。".into());
    }
    tauri::async_runtime::spawn_blocking(move || load_summary(&app, start_ts))
        .await
        .map_err(|_| UsageError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
