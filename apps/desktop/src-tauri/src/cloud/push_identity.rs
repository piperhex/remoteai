//! Capture notification routing locally, then recheck it before delivery.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PushIdentity {
    pub(crate) base_url: String,
    pub(crate) owner_id: String,
    pub(crate) device_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PushRoute {
    pub(crate) base_url: String,
    pub(crate) owner_id: String,
}

#[derive(Default)]
struct PushRouting(Mutex<Option<PushRoute>>);

fn route(settings: &AppSettings) -> Option<PushRoute> {
    Some(PushRoute {
        base_url: base_url(settings).ok()?.trim_end_matches('/').to_owned(),
        owner_id: settings.cloud_user_id.clone()?,
    })
}

/// Initialize before GUI events can arrive; later updates follow successful settings writes.
pub(crate) fn initialize_push_routing<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) {
    app.manage(PushRouting(Mutex::new(route(settings))));
}

/// Only memory is touched under this lock. Settings writers serialize the disk commit and this update.
pub(crate) fn remember_push_routing<R: Runtime>(app: &tauri::AppHandle<R>, settings: &AppSettings) {
    initialize_push_routing(app, settings);
    let state = app.state::<PushRouting>();
    let mut current = state.0.lock().unwrap_or_else(|error| error.into_inner());
    *current = route(settings);
}

/// Capture the recipient when an event arrives, without waiting for cloud requests or disk I/O.
pub(crate) fn push_route<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<PushRoute>, String> {
    let state = app
        .try_state::<PushRouting>()
        .ok_or_else(|| "Notification routing is unavailable".to_string())?;
    let current = state
        .0
        .lock()
        .map_err(|_| "Notification routing is unavailable".to_string())?;
    Ok(current.clone())
}

/// Resolve the stable device ID on the persistence worker, retaining the captured account and server.
pub(crate) fn push_identity_for_route<R: Runtime>(
    app: &tauri::AppHandle<R>,
    route: &PushRoute,
) -> Result<PushIdentity, String> {
    Ok(PushIdentity {
        base_url: route.base_url.clone(),
        owner_id: route.owner_id.clone(),
        device_id: read_or_create_installation_state(app)?.device_id,
    })
}

fn identity<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<Option<PushIdentity>, String> {
    let Some(owner_id) = settings.cloud_user_id.clone() else {
        return Ok(None);
    };
    Ok(Some(PushIdentity {
        base_url: base_url(settings)?.trim_end_matches('/').to_owned(),
        owner_id,
        device_id: read_or_create_installation_state(app)?.device_id,
    }))
}

/// Local routing reads never wait for the credential lock held by network requests.
pub(crate) fn push_identity<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<PushIdentity>, String> {
    push_route(app)?
        .map(|route| push_identity_for_route(app, &route))
        .transpose()
}

/// Saved events must never borrow another account's credentials after logout or server switching.
pub(crate) fn push_access_token(
    app: &tauri::AppHandle,
    expected: &PushIdentity,
) -> Result<Option<String>, String> {
    let (mut settings, mut credentials) = cloud_snapshot(app)?;
    if identity(app, &settings)?.as_ref() != Some(expected) {
        return Ok(None);
    }
    let Some(token) = credentials.access_token.as_ref() else {
        return Ok(None);
    };
    if access_token_expires_soon(token) {
        refresh_cloud_token(app, &api_client()?, &mut settings, &mut credentials)?;
        persist_cloud_sync(app, &settings, &credentials)?;
    }
    Ok(credentials.access_token)
}

#[cfg(test)]
mod tests;
