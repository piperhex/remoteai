use super::{credentials::Credentials, Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

pub(super) const AUTHORIZE: &str = "https://claude.com/cai/oauth/authorize";
pub(super) const CALLBACK: &str = "https://platform.claude.com/oauth/code/callback";
const TOKEN: &str = "https://platform.claude.com/v1/oauth/token";
const PROFILE: &str = "https://api.anthropic.com/api/oauth/profile";
// Public CLI client identifier, not a client secret. This is not a supported third-party OAuth integration.
pub(super) const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
pub(super) const SCOPES: &str = concat!(
    "org:create_api_key user:profile user:inference ",
    "user:sessions:claude_code user:mcp_servers user:file_upload user:plugins"
);

pub(super) struct Pkce {
    pub state: String,
    pub verifier: String,
    pub url: String,
}

pub(super) fn pkce() -> Result<Pkce> {
    let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse(AUTHORIZE).map_err(|_| Error::Invalid)?;
    url.query_pairs_mut().extend_pairs([
        ("code", "true"),
        ("client_id", CLIENT_ID),
        ("response_type", "code"),
        ("redirect_uri", CALLBACK),
        ("scope", SCOPES),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ]);
    Ok(Pkce {
        state,
        verifier,
        url: url.to_string(),
    })
}

pub(super) fn client() -> Result<Client> {
    crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| Error::Network)
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    scope: Option<String>,
}

pub(super) fn exchange(pkce: &Pkce, code: &str) -> Result<(Credentials, Value)> {
    exchange_at(&client()?, (TOKEN, PROFILE), pkce, code)
}

pub(super) fn exchange_at(
    client: &Client,
    endpoints: (&str, &str),
    pkce: &Pkce,
    code: &str,
) -> Result<(Credentials, Value)> {
    let tokens = token_request(
        client,
        endpoints.0,
        json!({ "grant_type": "authorization_code", "client_id": CLIENT_ID,
        "code": code, "redirect_uri": CALLBACK, "code_verifier": pkce.verifier, "state": pkce.state }),
    )?;
    let credentials = into_credentials(tokens, None)?;
    let profile = profile_at(client, endpoints.1, &credentials.access_token)?;
    Ok((credentials, profile))
}

fn token_request(client: &Client, endpoint: &str, payload: Value) -> Result<Tokens> {
    let response = client
        .post(endpoint)
        .json(&payload)
        .send()
        .map_err(|_| Error::Network)?;
    if [
        reqwest::StatusCode::BAD_REQUEST,
        reqwest::StatusCode::UNAUTHORIZED,
    ]
    .contains(&response.status())
    {
        return Err(Error::SignedOut);
    }
    if !response.status().is_success() {
        return Err(Error::Network);
    }
    response.json().map_err(|_| Error::Login)
}

fn into_credentials(tokens: Tokens, previous: Option<&Credentials>) -> Result<Credentials> {
    if tokens.access_token.is_empty() || tokens.expires_in <= 0 || tokens.expires_in > 31_536_000 {
        return Err(Error::Login);
    }
    Ok(Credentials {
        access_token: tokens.access_token,
        refresh_token: tokens
            .refresh_token
            .or_else(|| previous.and_then(|value| value.refresh_token.clone())),
        expires_at: chrono::Utc::now().timestamp_millis() + tokens.expires_in * 1000,
        scopes: tokens
            .scope
            .map(|value| value.split_whitespace().map(str::to_owned).collect())
            .unwrap_or_else(|| {
                previous
                    .map(|value| value.scopes.clone())
                    .unwrap_or_else(|| SCOPES.split_whitespace().map(str::to_owned).collect())
            }),
        subscription_type: previous.and_then(|value| value.subscription_type.clone()),
        rate_limit_tier: previous.and_then(|value| value.rate_limit_tier.clone()),
    })
}

pub(super) fn refresh(previous: &Credentials) -> Result<Credentials> {
    refresh_at(&client()?, TOKEN, previous)
}

pub(super) fn refresh_at(
    client: &Client,
    endpoint: &str,
    previous: &Credentials,
) -> Result<Credentials> {
    let refresh = previous
        .refresh_token
        .as_ref()
        .filter(|value| !value.is_empty())
        .ok_or(Error::SignedOut)?;
    let tokens = token_request(
        client,
        endpoint,
        json!({ "grant_type": "refresh_token",
        "client_id": CLIENT_ID, "refresh_token": refresh }),
    )?;
    into_credentials(tokens, Some(previous))
}

pub(super) fn profile(access: &str) -> Result<Value> {
    profile_at(&client()?, PROFILE, access)
}

fn profile_at(client: &Client, endpoint: &str, access: &str) -> Result<Value> {
    let response = client
        .get(endpoint)
        .bearer_auth(access)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .map_err(|_| Error::Network)?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::SignedOut);
    }
    if !response.status().is_success() {
        return Err(Error::Network);
    }
    response.json().map_err(|_| Error::Login)
}

pub(super) fn account_config(profile: &Value) -> Result<Value> {
    let account = &profile["account"];
    let organization = &profile["organization"];
    let email = account["email"]
        .as_str()
        .or_else(|| account["email_address"].as_str())
        .ok_or(Error::Login)?;
    Ok(
        json!({ "emailAddress": email, "accountUuid": account["uuid"].as_str().ok_or(Error::Login)?,
            "organizationUuid": organization["uuid"].as_str().ok_or(Error::Login)?,
            "organizationName": organization["name"], "displayName": account["display_name"],
            "organizationRole": account["role"], "hasExtraUsageEnabled": organization["has_extra_usage_enabled"],
        }),
    )
}
