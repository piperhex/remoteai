//! Account-scoped SSH access for the authenticated GUI engine. Secrets never enter model output.
use super::*;
use csw_ssh_client::{Connect, Endpoint, Size};
use std::sync::Arc;

pub(super) struct AgentSession {
    identity: GuiCloudIdentity,
    credentials: CloudCredentials,
}

#[derive(Clone)]
pub(super) struct Target {
    pub(super) id: String,
    pub(super) revision: u64,
}

pub(super) fn session<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Arc<AgentSession>, ProfileError> {
    let (settings, credentials) = cloud_snapshot(app).map_err(|_| ProfileError::Unavailable)?;
    if !cloud_state(&settings, &credentials).authenticated {
        return Err(ProfileError::Authentication);
    }
    let identity = GuiCloudIdentity {
        base_url: base_url(&settings)
            .map_err(|_| ProfileError::Authentication)?
            .to_owned(),
        user_id: settings.cloud_user_id.ok_or(ProfileError::Authentication)?,
    };
    Ok(Arc::new(AgentSession {
        identity,
        credentials,
    }))
}

impl AgentSession {
    pub(super) fn check<R: Runtime>(&self, app: &tauri::AppHandle<R>) -> Result<(), ProfileError> {
        ensure_cloud_session(app, &self.credentials).map_err(|_| ProfileError::Authentication)
    }

    fn exchange<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        request: SshProfileRequest,
    ) -> Result<SshProfileReply, ProfileError> {
        self.check(app)?;
        let identity = GuiCloudIdentity {
            base_url: self.identity.base_url.clone(),
            user_id: self.identity.user_id.clone(),
        };
        let reply = exchange(app, identity, request)?;
        self.check(app)?;
        Ok(reply)
    }

    fn profiles<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<Vec<SshProfile>, ProfileError> {
        match self.exchange(app, SshProfileRequest::List)? {
            SshProfileReply::Profiles(profiles) => Ok(profiles),
            _ => Err(ProfileError::Unavailable),
        }
    }

    pub(super) fn prepare<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        target: &Target,
    ) -> Result<(Connect, bool), ProfileError> {
        self.check(app)?;
        if !valid_id(&target.id) || target.revision == 0 || target.revision > 9_007_199_254_740_990
        {
            return Err(ProfileError::Invalid);
        }
        let cached = cache::read(app, &self.identity, &self.credentials, |cache| {
            let profile = select_profile(cache.profiles()?, &target.id, target.revision).ok()?;
            let secret = cache.credentials(&profile)?;
            Some((profile, secret))
        })
        .flatten();
        if let Some((profile, secret)) = cached {
            self.check(app)?;
            return authenticated_connection(profile, secret).map(|request| (request, true));
        }
        self.refresh(app, target).map(|request| (request, false))
    }

    pub(super) fn refresh<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        target: &Target,
    ) -> Result<Connect, ProfileError> {
        let result = super::execution::retry_sync(|| self.sync_connection(app, target));
        if matches!(result, Err(ProfileError::CredentialsUnavailable)) {
            cache::update(app, &self.identity, &self.credentials, |cache| {
                cache.forget_credentials(&target.id)
            });
        }
        result
    }

    fn sync_connection<R: Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        target: &Target,
    ) -> Result<Connect, ProfileError> {
        let profile = select_profile(self.profiles(app)?, &target.id, target.revision)?;
        connection(profile.clone())?;
        let reply = self.exchange(
            app,
            SshProfileRequest::Credentials {
                id: target.id.clone(),
                revision: target.revision,
            },
        )?;
        let SshProfileReply::Credentials(reply) = reply else {
            return Err(ProfileError::Unavailable);
        };
        let secret = reply
            .credentials
            .ok_or(ProfileError::CredentialsUnavailable)?;
        let request = authenticated_connection(profile.clone(), secret.clone())?;
        cache::update(app, &self.identity, &self.credentials, |cache| {
            cache.save(&profile, secret)
        });
        self.check(app)?;
        Ok(request)
    }

    pub(super) fn refresh_later<R: Runtime>(
        self: &Arc<Self>,
        app: &tauri::AppHandle<R>,
        target: Option<Target>,
    ) {
        let key = target
            .as_ref()
            .map_or("list".to_owned(), |target| format!("profile:{}", target.id));
        let Some(lease) = cache::start_refresh(&self.credentials, &key) else {
            return;
        };
        let app = app.clone();
        let session = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _lease = lease;
            let result = match target {
                Some(target) => session.refresh(&app, &target).map(|_| ()),
                None => super::execution::retry_sync(|| session.profiles(&app)).map(|_| ()),
            };
            if let Err(error) = result {
                eprintln!("SSH cache refresh failed: {error}");
            }
        });
    }
}

pub(crate) fn agent_ssh_profiles<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<SshProfile>, ProfileError> {
    let session = session(app)?;
    let cached = cache::read(app, &session.identity, &session.credentials, |cache| {
        cache.profiles()
    })
    .flatten();
    if let Some(profiles) = cached {
        session.check(app)?;
        session.refresh_later(app, None);
        return Ok(profiles);
    }
    super::execution::retry_sync(|| session.profiles(app))
}

fn authenticated_connection(
    profile: SshProfile,
    secret: SshCredentials,
) -> Result<Connect, ProfileError> {
    if !secret.matches_auth(&profile.auth) {
        return Err(ProfileError::CredentialsUnavailable);
    }
    let mut request = connection(profile)?;
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
