//! Devices automatically report compact official-account records. Summaries are computed by the server.
mod local;
mod summary;
pub(crate) use summary::*;

use super::*;
use std::sync::atomic::AtomicBool;

const REPORT_INTERVAL: Duration = Duration::from_secs(60);
static REPORTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, thiserror::Error)]
enum UsageError {
    #[error("暂时无法读取或上传官方账户用量，请稍后重试。")]
    Unavailable,
}

struct ReportGuard;
impl Drop for ReportGuard {
    fn drop(&mut self) {
        REPORTING.store(false, Ordering::Release);
    }
}

fn report_records<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), UsageError> {
    if REPORTING.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let _guard = ReportGuard;
    let settings = read_app_settings(app).map_err(|_| UsageError::Unavailable)?;
    let credentials = read_cloud_credentials(app);
    if !cloud_state(&settings, &credentials).authenticated {
        return Ok(());
    }
    let installation =
        read_or_create_installation_state(app).map_err(|_| UsageError::Unavailable)?;
    let identity = format!(
        "{:?}:{:?}:{}",
        settings.cloud_base_url, settings.cloud_user_id, installation.device_id
    );
    let filename = format!(
        "official-usage-report-{:x}.json",
        Sha256::digest(identity.as_bytes())
    );
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| UsageError::Unavailable)?
        .join(filename);
    let checkpoint: local::ReportCheckpoint = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let snapshot = local::snapshot(app).map_err(|_| UsageError::Unavailable)?;
    let (reports, checkpoint) =
        local::prepare_report(snapshot, checkpoint).map_err(|_| UsageError::Unavailable)?;
    if !reports.is_empty() {
        upload_reports(app, reports, &identity)?;
    }
    // A failed batch leaves the checkpoint untouched. Absolute minute totals make retrying safe.
    let value = serde_json::to_value(checkpoint).map_err(|_| UsageError::Unavailable)?;
    write_json_atomic(&path, &value).map_err(|_| UsageError::Unavailable)
}

fn upload_reports<R: Runtime>(
    app: &tauri::AppHandle<R>,
    reports: Vec<local::UsageReport>,
    identity: &str,
) -> Result<(), UsageError> {
    for report in reports {
        upload_report(app, report, identity)?;
    }
    Ok(())
}

// Release the credentials lock between batches so initial backfill cannot starve account actions.
fn upload_report<R: Runtime>(
    app: &tauri::AppHandle<R>,
    report: local::UsageReport,
    identity: &str,
) -> Result<(), UsageError> {
    let _guard = lock_cloud_credentials().map_err(|_| UsageError::Unavailable)?;
    let mut settings = read_app_settings(app).map_err(|_| UsageError::Unavailable)?;
    let mut credentials = read_cloud_credentials(app);
    let current = format!(
        "{:?}:{:?}:{}",
        settings.cloud_base_url,
        settings.cloud_user_id,
        credentials.device_id.as_deref().unwrap_or_default()
    );
    if current != identity {
        return Err(UsageError::Unavailable);
    }
    let client = api_client().map_err(|_| UsageError::Unavailable)?;
    let payload = serde_json::to_value(report).map_err(|_| UsageError::Unavailable)?;
    cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        Method::POST,
        "/official-usage/records",
        Some(payload),
    )
    .map_err(|_| UsageError::Unavailable)?
    .error_for_status()
    .map_err(|_| UsageError::Unavailable)?;
    write_app_settings(app, &settings).map_err(|_| UsageError::Unavailable)?;
    write_cloud_credentials(app, &credentials).map_err(|_| UsageError::Unavailable)
}

/// Reporting continues while all usage pages are closed and never blocks the window thread.
pub(crate) fn start_official_usage_reporting<R: Runtime + 'static>(app: tauri::AppHandle<R>) {
    if cfg!(test) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            let handle = app.clone();
            match tauri::async_runtime::spawn_blocking(move || report_records(&handle)).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("official usage reporting failed: {error}"),
                Err(error) => eprintln!("official usage reporting worker failed: {error}"),
            }
            tokio::time::sleep(REPORT_INTERVAL).await;
        }
    });
}
