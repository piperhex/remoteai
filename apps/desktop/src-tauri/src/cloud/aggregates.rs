use super::*;
use crate::aggregate_sync::{self, AggregateSyncPayload};
use std::io::Read;

const MAX_SYNC_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub(super) enum AggregateSyncError {
    #[error("Update the cloud service to sync aggregate APIs")]
    Unsupported,
    #[error("{0}")]
    Failed(String),
}

impl From<String> for AggregateSyncError {
    fn from(message: String) -> Self {
        Self::Failed(message)
    }
}

/// Only an unavailable optional collection may be deferred during authentication.
pub(super) fn authentication_warning(
    result: Result<usize, AggregateSyncError>,
) -> Result<Option<CloudSyncWarning>, String> {
    match result {
        Ok(_) => Ok(None),
        Err(AggregateSyncError::Unsupported) => {
            Ok(Some(CloudSyncWarning::AggregateSyncUnavailable))
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Aggregate records use a separate collection so older clients cannot erase their policies.
pub(super) fn sync_aggregates<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, AggregateSyncError> {
    let paths = resolve_paths(app)?;
    let local = aggregate_sync::collect(&paths)?;
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        "/sync/aggregates",
        Some(serde_json::to_value(&local).map_err(|e| e.to_string())?),
    )?;
    if response.status() == StatusCode::NOT_FOUND && local.aggregates.is_empty() {
        return Ok(0);
    }
    if response.status() == StatusCode::NOT_FOUND {
        return Err(AggregateSyncError::Unsupported);
    }
    if !response.status().is_success() {
        return Err(response_error("Aggregate sync", response).into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_SYNC_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read aggregate sync response".to_string())?;
    if bytes.len() as u64 > MAX_SYNC_BYTES {
        return Err(AggregateSyncError::Failed(
            "Aggregate sync response is too large".into(),
        ));
    }
    let remote: AggregateSyncPayload = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid aggregate sync response".to_string())?;
    let changed = with_cloud_session(app, credentials, || aggregate_sync::apply(&paths, remote))?;
    if changed > 0 {
        crate::aggregate_api::refresh_targets(app, &paths)?;
        app.emit("aggregate-apis-changed", ())
            .map_err(|e| e.to_string())?;
        app.emit("providers-changed", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(local.aggregates.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_unsupported_aggregate_sync_becomes_an_authentication_warning() {
        assert!(authentication_warning(Ok(2)).unwrap().is_none());
        let warning = authentication_warning(Err(AggregateSyncError::Unsupported)).unwrap();
        assert_eq!(
            serde_json::to_value(warning).unwrap(),
            "aggregateSyncUnavailable"
        );
        for message in [
            "Unauthorized",
            "Network unavailable",
            "Invalid aggregate sync response",
        ] {
            assert_eq!(
                authentication_warning(Err(AggregateSyncError::Failed(message.into())))
                    .unwrap_err(),
                message
            );
        }
    }
}
