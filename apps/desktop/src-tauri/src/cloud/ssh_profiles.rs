use super::*;
mod agent;
pub(super) mod cache;
mod credentials;
mod execution;
mod terminal;
pub(crate) use agent::agent_ssh_profiles;
use credentials::{SshCredentialReply, SshCredentials};
pub(crate) use execution::agent_ssh_execute;
pub(crate) use terminal::{agent_ssh_terminal, close_agent_ssh_terminals, TerminalRequest};

/// Stable saved-connection errors shared by the UI and the authenticated agent boundary.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ProfileError {
    #[error("client.ssh.trustHost")]
    Untrusted,
    #[error("client.ssh.signIn")]
    Authentication,
    #[error("client.ssh.invalid")]
    Invalid,
    #[error("client.ssh.profileChanged")]
    Conflict,
    #[error("client.ssh.profileLimit")]
    Limit,
    #[error("client.ssh.syncFailed")]
    Unavailable,
    #[error("client.ssh.credentialsUnavailable")]
    CredentialsUnavailable,
    #[error("client.ssh.updateRequired")]
    UpdateRequired,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshProfile {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth: Authentication,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    x11: Option<csw_ssh_client::X11>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Authentication {
    Password,
    Key,
}

/// A bounded, account-scoped command; credential material is never stored in desktop settings.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum SshProfileRequest {
    List,
    Save {
        profile: Box<SshProfile>,
        credentials: Option<SshCredentials>,
    },
    Credentials {
        id: String,
        revision: u64,
    },
    Remove {
        id: String,
        revision: u64,
    },
    Import {
        profiles: Vec<SshProfile>,
    },
}

/// Keep the existing metadata response compatible with older clients.
#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum SshProfileReply {
    Profiles(Vec<SshProfile>),
    Credentials(SshCredentialReply),
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}

fn valid_profile(value: &SshProfile) -> bool {
    valid_id(&value.id)
        && value.port > 0
        && value.name.chars().count() <= 80
        && !value.host.is_empty()
        && value.host.len() <= 253
        && !value
            .host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
        && !value.username.trim().is_empty()
        && value.username.chars().count() <= 256
        && !value.username.chars().any(char::is_control)
        && value.fingerprint.as_ref().is_none_or(|v| v.len() <= 256)
        && value.revision.is_none_or(|v| v <= 9_007_199_254_740_990)
        && value
            .x11
            .as_ref()
            .is_none_or(|options| options.validate().is_ok())
}

fn request_parts(
    request: SshProfileRequest,
) -> Result<(Method, String, Option<Value>), ProfileError> {
    let path = "/sync/ssh-profiles";
    match request {
        SshProfileRequest::List => Ok((Method::GET, path.into(), None)),
        SshProfileRequest::Save {
            profile,
            credentials,
        } if valid_profile(&profile)
            && credentials
                .as_ref()
                .is_none_or(|secret| secret.matches_auth(&profile.auth)) =>
        {
            let target = format!("{path}/{}", profile.id);
            let mut body = json!(profile);
            if let Some(secret) = credentials {
                body["credentials"] = json!(secret);
            }
            Ok((Method::PUT, target, Some(body)))
        }
        SshProfileRequest::Credentials { id, revision }
            if valid_id(&id) && revision > 0 && revision <= 9_007_199_254_740_990 =>
        {
            Ok((
                Method::POST,
                format!("{path}/{id}/credentials"),
                Some(json!({ "revision": revision })),
            ))
        }
        SshProfileRequest::Remove { id, revision } if valid_id(&id) && revision > 0 => Ok((
            Method::DELETE,
            format!("{path}/{id}"),
            Some(json!({ "revision": revision })),
        )),
        SshProfileRequest::Import { profiles }
            if profiles.len() <= 64 && profiles.iter().all(valid_profile) =>
        {
            Ok((
                Method::POST,
                format!("{path}/import"),
                Some(json!({ "profiles": profiles })),
            ))
        }
        _ => Err(ProfileError::Invalid),
    }
}

fn exchange<R: Runtime>(
    app: &tauri::AppHandle<R>,
    identity: GuiCloudIdentity,
    request: SshProfileRequest,
) -> Result<SshProfileReply, ProfileError> {
    let fetch_credentials = matches!(&request, SshProfileRequest::Credentials { .. });
    let (method, path, body) = request_parts(request)?;

    let (mut settings, mut credentials) =
        cloud_snapshot(app).map_err(|_| ProfileError::Unavailable)?;
    if base_url(&settings).ok() != Some(identity.base_url.as_str())
        || settings.cloud_user_id.as_deref() != Some(&identity.user_id)
        || !cloud_state(&settings, &credentials).authenticated
    {
        return Err(ProfileError::Authentication);
    }
    let client = api_client().map_err(|_| ProfileError::Unavailable)?;
    let generation = cache::next_generation(&credentials);
    let response = cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        method,
        &path,
        body,
    )
    .map_err(|_| ProfileError::Unavailable)?;
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(ProfileError::Authentication);
    }
    let reply = read_response(response, fetch_credentials)?;
    ensure_cloud_session(app, &credentials).map_err(|_| ProfileError::Authentication)?;
    if let SshProfileReply::Profiles(profiles) = &reply {
        cache::update(app, &identity, &credentials, |cache| {
            cache.observe(profiles, generation)
        });
    }
    Ok(reply)
}

fn read_response(
    response: CloudResponse,
    fetch_credentials: bool,
) -> Result<SshProfileReply, ProfileError> {
    if matches!(
        response.status(),
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
    ) {
        return Err(ProfileError::UpdateRequired);
    }
    if !response.status().is_success() {
        let error: Value = response.json().unwrap_or(Value::Null);
        return Err(match error["message"].as_str() {
            Some("client.ssh.profileChanged") => ProfileError::Conflict,
            Some("client.ssh.profileLimit") => ProfileError::Limit,
            Some("client.ssh.invalid") => ProfileError::Invalid,
            Some("client.ssh.credentialsUnavailable") => ProfileError::CredentialsUnavailable,
            _ => ProfileError::Unavailable,
        });
    }
    if fetch_credentials {
        let reply: SshCredentialReply = response.json().map_err(|_| ProfileError::Unavailable)?;
        if reply
            .credentials
            .as_ref()
            .is_some_and(|secret| !secret.valid())
        {
            return Err(ProfileError::Unavailable);
        }
        return Ok(SshProfileReply::Credentials(reply));
    }
    let profiles: Vec<SshProfile> = response.json().map_err(|_| ProfileError::Unavailable)?;
    if profiles.len() > 64 || !profiles.iter().all(valid_profile) {
        return Err(ProfileError::Unavailable);
    }
    Ok(SshProfileReply::Profiles(profiles))
}

/// All credential locking, filesystem access and HTTP work run outside the UI thread.
#[tauri::command]
pub(crate) async fn cloud_ssh_profiles(
    app: tauri::AppHandle,
    identity: GuiCloudIdentity,
    request: SshProfileRequest,
) -> Result<SshProfileReply, String> {
    tauri::async_runtime::spawn_blocking(move || exchange(&app, identity, request))
        .await
        .map_err(|_| ProfileError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_only_valid_x11_settings() {
        let mut input = json!({"id":"one", "name":"test", "host":"localhost", "port":22,
            "username":"me", "auth":"password", "x11":{"display":":0.1"}});
        let profile: SshProfile = serde_json::from_value(input.clone()).unwrap();
        assert!(valid_profile(&profile));
        assert_eq!(serde_json::to_value(profile).unwrap(), input);
        input["x11"] = json!({});
        let profile: SshProfile = serde_json::from_value(input.clone()).unwrap();
        assert!(valid_profile(&profile));
        assert_eq!(serde_json::to_value(profile).unwrap(), input);
        input["x11"]["display"] = "remote.test:0".into();
        let profile: SshProfile = serde_json::from_value(input.clone()).unwrap();
        assert!(!valid_profile(&profile));
        input["x11"]["cookie"] = "secret".into();
        assert!(serde_json::from_value::<SshProfile>(input).is_err());
    }

    #[test]
    fn rejects_credentials_paths_and_out_of_range_targets() {
        let input = json!({"id":"one", "name":"test", "host":"::1", "port":22,
            "username":"me", "auth":"key"});
        for key in ["password", "privateKey", "passphrase", "ownerId"] {
            let mut value = input.clone();
            value[key] = "secret".into();
            assert!(serde_json::from_value::<SshProfile>(value).is_err());
        }
        let mut profile: SshProfile = serde_json::from_value(input).unwrap();
        assert!(valid_profile(&profile));
        profile.id = "../other".into();
        assert!(!valid_profile(&profile));
        profile.id = "one".into();
        profile.port = 0;
        assert!(!valid_profile(&profile));
        assert!(request_parts(SshProfileRequest::Remove {
            id: "a?b".into(),
            revision: 1
        })
        .is_err());
    }

    #[test]
    fn credential_requests_use_separate_bounded_payloads() {
        let input = json!({"type":"save", "profile":{"id":"one", "name":"test", "host":"::1",
            "port":22, "username":"me", "auth":"key"},
            "credentials":{"privateKey":"test-key", "passphrase":"test-phrase"}});
        let request: SshProfileRequest = serde_json::from_value(input.clone()).unwrap();
        let (method, path, body) = request_parts(request).unwrap();
        assert_eq!(method, Method::PUT);
        assert_eq!(path, "/sync/ssh-profiles/one");
        assert_eq!(body.unwrap()["credentials"], input["credentials"]);
        let mut invalid = input;
        invalid["credentials"] = json!({"password":"wrong-auth"});
        assert!(request_parts(serde_json::from_value(invalid).unwrap()).is_err());

        let request = SshProfileRequest::Credentials {
            id: "one".into(),
            revision: 7,
        };
        let (method, path, body) = request_parts(request).unwrap();
        assert_eq!(method, Method::POST);
        assert_eq!(path, "/sync/ssh-profiles/one/credentials");
        assert_eq!(body, Some(json!({"revision":7})));
        for (id, revision) in [("../other", 1), ("one", 0), ("one", u64::MAX)] {
            assert!(request_parts(SshProfileRequest::Credentials {
                id: id.into(),
                revision
            })
            .is_err());
        }
    }
}
