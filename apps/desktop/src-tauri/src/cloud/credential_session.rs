//! Credential snapshots are bound to a login generation, server and owner.
//! Lock order for local mutations is data -> credentials -> lifecycle.
use super::*;
use std::sync::{atomic::AtomicU64, Arc};

#[derive(Debug, Default)]
pub(super) struct SessionEpoch {
    pub(super) refresh: super::refresh_flight::RefreshFlight,
    pub(super) ssh_cache: super::ssh_profiles::cache::SessionCache,
}

#[derive(Default)]
struct Lifecycle {
    epoch: Mutex<Arc<SessionEpoch>>,
    login_attempt: AtomicU64,
    // Identity changes wait for local data commits, never for HTTP requests.
    data: Mutex<()>,
}

#[derive(Debug, Clone)]
pub(super) struct SessionSnapshot {
    pub(super) epoch: Arc<SessionEpoch>,
    pub(super) refresh_version: u64,
    base_url: Option<String>,
    user_id: Option<String>,
}

/// Login attempts supersede older attempts without cancelling the current login.
pub(super) struct LoginTicket {
    base_url: Option<String>,
    attempt: u64,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum SessionError {
    // Reuse the existing translated sign-in error at the command boundary.
    #[error("Cloud access token is missing. Please log in again.")]
    Changed,
    #[error("Cloud credentials lock is unavailable")]
    Unavailable,
}

fn lifecycle<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::State<'_, Lifecycle> {
    app.manage(Lifecycle::default());
    app.state::<Lifecycle>()
}

fn epoch<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Arc<SessionEpoch>, String> {
    lifecycle(app)
        .epoch
        .lock()
        .map(|epoch| Arc::clone(&epoch))
        .map_err(|_| SessionError::Unavailable.to_string())
}

/// Called with the credentials lock, after excluding local data commits.
pub(super) fn invalidate_cloud_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    lifecycle(app).login_attempt.fetch_add(1, Ordering::Relaxed);
    expire_cloud_epoch(app)
}

/// Expiring old credentials must not cancel a newer login already in progress.
pub(super) fn expire_cloud_epoch<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    *lifecycle(app)
        .epoch
        .lock()
        .map_err(|_| SessionError::Unavailable.to_string())? = Arc::default();
    Ok(())
}

/// Called under the credential lock, before sending the login request.
pub(super) fn reserve_cloud_login<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(AppSettings, LoginTicket), String> {
    let settings = read_app_settings(app)?;
    let attempt = lifecycle(app).login_attempt.fetch_add(1, Ordering::Relaxed) + 1;
    let base_url = settings.cloud_base_url.clone();
    Ok((settings, LoginTicket { base_url, attempt }))
}

pub(super) fn current_cloud_login<R: Runtime>(
    app: &tauri::AppHandle<R>,
    ticket: &LoginTicket,
) -> Result<(AppSettings, CloudCredentials), String> {
    if lifecycle(app).login_attempt.load(Ordering::Relaxed) != ticket.attempt {
        return Err(SessionError::Changed.to_string());
    }
    let current = cloud_snapshot_locked(app)?;
    if current.0.cloud_base_url != ticket.base_url {
        return Err(SessionError::Changed.to_string());
    }
    Ok(current)
}

/// A fresh snapshot is captured atomically with its settings, without network I/O.
pub(super) fn cloud_snapshot<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(AppSettings, CloudCredentials), String> {
    let _guard = lock_cloud_credentials()?;
    cloud_snapshot_locked(app)
}

pub(super) fn cloud_snapshot_locked<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(AppSettings, CloudCredentials), String> {
    let settings = read_app_settings(app)?;
    let mut credentials = read_cloud_credentials(app);
    let epoch = epoch(app)?;
    credentials.session = Some(SessionSnapshot {
        refresh_version: epoch.refresh.version()?,
        epoch,
        base_url: settings.cloud_base_url.clone(),
        user_id: settings.cloud_user_id.clone(),
    });
    Ok((settings, credentials))
}

/// Validate while holding the credentials lock; token rotation keeps the same epoch.
pub(super) fn current_cloud_snapshot<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &CloudCredentials,
) -> Result<(AppSettings, CloudCredentials), String> {
    let (settings, current) = cloud_snapshot_locked(app)?;
    let old = expected
        .session
        .as_ref()
        .ok_or(SessionError::Changed.to_string())?;
    let new = current
        .session
        .as_ref()
        .ok_or(SessionError::Changed.to_string())?;
    if !Arc::ptr_eq(&old.epoch, &new.epoch)
        || old.base_url != new.base_url
        || old.user_id != new.user_id
    {
        return Err(SessionError::Changed.to_string());
    }
    Ok((settings, current))
}

pub(super) fn ensure_cloud_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &CloudCredentials,
) -> Result<(), String> {
    let _guard = lock_cloud_credentials()?;
    current_cloud_snapshot(app, expected).map(|_| ())
}

/// Adopt rotated tokens only inside the captured session, never a new login's tokens.
pub(super) fn prepare_cloud_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<(), String> {
    let _guard = lock_cloud_credentials()?;
    let (current_settings, current) = current_cloud_snapshot(app, credentials)?;
    if settings.cloud_base_url != current_settings.cloud_base_url
        || settings.cloud_user_id != current_settings.cloud_user_id
    {
        return Err(SessionError::Changed.to_string());
    }
    *credentials = current;
    Ok(())
}

/// Run a local data commit or identity change. This guard must never cover HTTP I/O.
pub(super) fn with_cloud_data<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = lifecycle(app);
    let _guard = state
        .data
        .lock()
        .map_err(|_| SessionError::Unavailable.to_string())?;
    commit()
}

pub(super) fn with_cloud_session<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    credentials: &CloudCredentials,
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    with_cloud_data(app, || {
        ensure_cloud_session(app, credentials)?;
        commit()
    })
}

/// Business requests never write credentials back. Merge only their sync timestamp.
pub(super) fn persist_cloud_sync<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
    credentials: &CloudCredentials,
) -> Result<(), String> {
    let _guard = lock_cloud_credentials()?;
    let (mut current, _) = current_cloud_snapshot(app, credentials)?;
    if settings.cloud_last_sync_at > current.cloud_last_sync_at {
        current
            .cloud_last_sync_at
            .clone_from(&settings.cloud_last_sync_at);
        write_app_settings(app, &current)?;
    }
    Ok(())
}
