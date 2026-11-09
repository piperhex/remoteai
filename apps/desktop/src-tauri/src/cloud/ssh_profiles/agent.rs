//! Account-scoped SSH access for the authenticated GUI engine. Secrets never enter model output.
use super::*;
use csw_ssh_client::{Connect, Endpoint, Size};

fn identity(app: &tauri::AppHandle) -> Result<GuiCloudIdentity, ProfileError> {
    let (settings, credentials) = cloud_snapshot(app).map_err(|_| ProfileError::Unavailable)?;
    if !cloud_state(&settings, &credentials).authenticated {
        return Err(ProfileError::Authentication);
    }
    Ok(GuiCloudIdentity {
        base_url: base_url(&settings)
            .map_err(|_| ProfileError::Authentication)?
            .to_owned(),
        user_id: settings.cloud_user_id.ok_or(ProfileError::Authentication)?,
    })
}

fn profiles(
    app: &tauri::AppHandle,
    identity: GuiCloudIdentity,
) -> Result<Vec<SshProfile>, ProfileError> {
    match exchange(app, identity, SshProfileRequest::List)? {
        SshProfileReply::Profiles(profiles) => Ok(profiles),
        _ => Err(ProfileError::Unavailable),
    }
}

pub(crate) fn agent_ssh_profiles(app: &tauri::AppHandle) -> Result<Vec<SshProfile>, ProfileError> {
    identity(app).and_then(|identity| profiles(app, identity))
}

pub(crate) fn agent_ssh_connect(
    app: &tauri::AppHandle,
    id: &str,
    revision: u64,
) -> Result<Connect, ProfileError> {
    prepare(app, id, revision)
}

fn prepare(app: &tauri::AppHandle, id: &str, revision: u64) -> Result<Connect, ProfileError> {
    if !valid_id(id) || revision == 0 {
        return Err(ProfileError::Invalid);
    }
    let identity = identity(app)?;
    let current = GuiCloudIdentity {
        base_url: identity.base_url.clone(),
        user_id: identity.user_id.clone(),
    };
    let profile = select_profile(profiles(app, current)?, id, revision)?;
    let auth = profile.auth;
    let mut request = connection(profile)?;
    let reply = exchange(
        app,
        identity,
        SshProfileRequest::Credentials {
            id: id.into(),
            revision,
        },
    )?;
    let SshProfileReply::Credentials(reply) = reply else {
        return Err(ProfileError::Unavailable);
    };
    let secret = reply
        .credentials
        .ok_or(ProfileError::CredentialsUnavailable)?;
    if !secret.matches_auth(&auth) {
        return Err(ProfileError::CredentialsUnavailable);
    }
    secret.apply(&mut request);
    request.validate().map_err(|_| ProfileError::Invalid)?;
    Ok(request)
}

fn select_profile(
    profiles: Vec<SshProfile>,
    id: &str,
    revision: u64,
) -> Result<SshProfile, ProfileError> {
    profiles
        .into_iter()
        .find(|profile| profile.id == id)
        .filter(|profile| profile.revision == Some(revision))
        .ok_or(ProfileError::Conflict)
}

fn connection(profile: SshProfile) -> Result<Connect, ProfileError> {
    let fingerprint = profile
        .fingerprint
        .filter(|value| value.starts_with("SHA256:"))
        .ok_or(ProfileError::Untrusted)?;
    Ok(Connect {
        endpoint: Endpoint {
            host: profile.host,
            port: profile.port,
        },
        username: profile.username,
        fingerprint,
        password: None,
        private_key: None,
        passphrase: None,
        size: Size { cols: 80, rows: 24 },
        // Non-interactive commands do not request a graphical session.
        x11: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> SshProfile {
        serde_json::from_value(
            json!({"id":"development", "name":"开发服务器", "host":"localhost",
            "port":22, "username":"fixture", "auth":"key", "revision":3,
            "fingerprint":"SHA256:fixture"}),
        )
        .unwrap()
    }

    #[test]
    fn changed_or_removed_profiles_are_rejected_instead_of_substituting_an_endpoint() {
        assert!(select_profile(vec![profile()], "development", 3).is_ok());
        assert!(matches!(
            select_profile(vec![profile()], "development", 2),
            Err(ProfileError::Conflict)
        ));
        assert!(matches!(
            select_profile(vec![profile()], "other", 3),
            Err(ProfileError::Conflict)
        ));
        assert!(matches!(
            select_profile(vec![], "development", 3),
            Err(ProfileError::Conflict)
        ));
    }

    #[test]
    fn requires_saved_host_trust_and_transfers_login_material_only_to_the_connection() {
        let mut untrusted = profile();
        untrusted.fingerprint = None;
        assert!(matches!(
            connection(untrusted),
            Err(ProfileError::Untrusted)
        ));
        let mut request = connection(profile()).unwrap();
        assert!(request.private_key.is_none());
        let secret: SshCredentials = serde_json::from_value(json!({"privateKey":"fixture-key",
            "passphrase":"fixture-passphrase"}))
        .unwrap();
        assert!(secret.matches_auth(&Authentication::Key));
        assert!(!secret.matches_auth(&Authentication::Password));
        secret.apply(&mut request);
        assert_eq!(request.private_key.as_deref(), Some("fixture-key"));
        assert_eq!(request.passphrase.as_deref(), Some("fixture-passphrase"));
        assert!(request.password.is_none());
        assert!(serde_json::to_value(profile())
            .unwrap()
            .get("credentials")
            .is_none());
    }
}
