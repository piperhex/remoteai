//! Refresh only an existing, enabled service; starting the app never creates a new remote-access grant.
use super::{control, setup, Result, ServiceError};
use semver::Version;
use tauri::AppHandle;

/// One attempt per application launch, off the UI thread. Cancellation retries on the next launch.
pub(crate) fn start(app: &AppHandle) {
    let version = app.package_info().version.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = update_installed(version).await {
            eprintln!("Unattended desktop startup update failed: {error}");
        }
    });
}

async fn update_installed(version: Version) -> Result<()> {
    if !setup::supported() {
        return Ok(());
    }
    // Share serialization with manual setup. The async guard can move to the blocking installer.
    let guard = setup::CHANGES.lock().await;
    if !control::running().await? {
        return Ok(());
    }
    let snapshot = control::read().await?;
    if !needs_update(&snapshot, &version)? {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        super::installer::source_executable()?;
        setup::elevate("--update-desktop-service", Some(&version.to_string()))
    })
    .await
    .map_err(|_| ServiceError::Unavailable)?
}

fn needs_update(snapshot: &control::Snapshot, current: &Version) -> Result<bool> {
    if !snapshot.permissions.enabled {
        return Ok(false);
    }
    let Some(installed) = snapshot.version.as_deref() else {
        // The old owner-only status endpoint is safe to query, but did not advertise a version.
        return Ok(true);
    };
    let installed = Version::parse(installed).map_err(|_| ServiceError::Invalid)?;
    Ok(current.cmp_precedence(&installed).is_gt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(version: Option<&str>) -> control::Snapshot {
        control::Snapshot {
            version: version.map(str::to_owned),
            permissions: crate::remote_desktop::permissions::Permissions {
                enabled: true,
                ..Default::default()
            },
            base_url: "https://example.test".into(),
            name: "Fixture".into(),
        }
    }

    #[test]
    fn updates_legacy_and_older_services_without_downgrading() {
        let current = Version::parse("1.7.11").unwrap();
        for installed in [None, Some("1.7.3"), Some("1.7.9"), Some("1.7.11-beta.1")] {
            assert!(needs_update(&snapshot(installed), &current).unwrap());
        }
        for installed in ["1.7.11", "1.7.11+rebuilt", "1.7.12", "1.8.0"] {
            assert!(!needs_update(&snapshot(Some(installed)), &current).unwrap());
        }
        assert!(needs_update(&snapshot(Some("invalid")), &current).is_err());
    }

    #[test]
    fn disabled_remote_access_never_requests_an_update() {
        let mut snapshot = snapshot(None);
        snapshot.permissions.enabled = false;
        assert!(!needs_update(&snapshot, &Version::parse("1.7.11").unwrap()).unwrap());
    }

    #[test]
    fn old_status_remains_compatible_and_credentials_are_not_returned() {
        let old = serde_json::json!({
            "permissions": crate::remote_desktop::permissions::Permissions::default(),
            "baseUrl": "https://example.test", "name": "Fixture"
        });
        let snapshot: control::Snapshot = serde_json::from_value(old).unwrap();
        assert!(snapshot.version.is_none());
        let fields = serde_json::to_value(snapshot).unwrap();
        assert!(fields.get("credential").is_none());
        assert!(fields.get("identitySecret").is_none());
    }
}
