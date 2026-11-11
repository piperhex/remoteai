use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::json;
use sha2::{Digest, Sha256};

fn credentials() -> credentials::Credentials {
    credentials::Credentials {
        access_token: "mock-access".into(),
        refresh_token: Some("mock-refresh".into()),
        expires_at: chrono::Utc::now().timestamp_millis() + 3_600_000,
        scopes: vec!["user:profile".into()],
        subscription_type: Some("pro".into()),
        rate_limit_tier: None,
    }
}

fn account(id: &str) -> Value {
    json!({ "accountUuid": id, "organizationUuid": "mock-org", "emailAddress": format!("{id}@example.com") })
}

#[test]
fn pkce_is_random_and_binds_sha256_challenge() {
    let first = oauth::pkce().unwrap();
    let second = oauth::pkce().unwrap();
    assert_ne!(first.state, second.state);
    assert_ne!(first.verifier, second.verifier);
    assert_eq!(first.verifier.len(), 43);
    let url = url::Url::parse(&first.url).unwrap();
    let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
    assert_eq!(query["client_id"], oauth::CLIENT_ID);
    assert_eq!(query["redirect_uri"], oauth::CALLBACK);
    assert_eq!(query["code_challenge_method"], "S256");
    assert_eq!(
        query["code_challenge"],
        URL_SAFE_NO_PAD.encode(Sha256::digest(first.verifier.as_bytes()))
    );
}

#[test]
fn callbacks_reject_wrong_state_origin_and_terminal_input() {
    let pkce = oauth::pkce().unwrap();
    assert_eq!(
        login::normalize_code("mock-code", &pkce.url).unwrap(),
        format!("mock-code#{}", pkce.state)
    );
    assert!(login::normalize_code("mock-code#wrong", &pkce.url).is_err());
    assert!(login::normalize_code("mock\ncode", &pkce.url).is_err());
    assert!(login::normalize_code("https://evil.example/?code=x&state=x", &pkce.url).is_err());
    let callback = format!("{}?code=mock-code&state={}", oauth::CALLBACK, pkce.state);
    assert!(login::normalize_code(&callback, &pkce.url).is_ok());
    assert!(login::normalize_code(
        &format!("{}?error=access_denied", oauth::CALLBACK),
        &pkce.url
    )
    .is_err());
}

#[test]
fn cancelled_authorization_cannot_be_submitted() {
    let status = pkce_login::start(None).unwrap();
    pkce_login::cancel(&status.login_id).unwrap();
    assert_eq!(
        pkce_login::poll(&status.login_id).unwrap().status,
        "cancelled"
    );
    let root = tempfile::tempdir().unwrap();
    assert!(matches!(
        pkce_login::submit(root.path(), &status.login_id, "mock-code"),
        Err(Error::Expired)
    ));
}

#[test]
fn native_write_preserves_settings_and_unrelated_credential_fields() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("profile");
    let config = json!({ "mcpServers": { "test": { "command": "example" } }, "projects": { "work": {} },
        "oauthAccount": account("old") });
    native::write_json(&native::config_path(&directory).unwrap(), &config).unwrap();
    native::write_json(
        &directory.join("settings.json"),
        &json!({ "theme": "dark", "permissions": {} }),
    )
    .unwrap();
    native::write_json(
        &directory.join(".credentials.json"),
        &json!({ "mcpOAuth": { "sample": "mock-mcp" } }),
    )
    .unwrap();
    native::apply(&directory, &credentials(), &account("new")).unwrap();
    let next = native::read_json(&native::config_path(&directory).unwrap()).unwrap();
    assert_eq!(next["projects"], config["projects"]);
    assert_eq!(next["mcpServers"], config["mcpServers"]);
    assert_eq!(next["oauthAccount"], account("new"));
    assert_eq!(
        native::read_credentials(&directory).unwrap()["mcpOAuth"]["sample"],
        "mock-mcp"
    );
    assert_eq!(
        native::read_json(&directory.join("settings.json")).unwrap()["theme"],
        "dark"
    );
    assert!(directory.join(".remoteai-account-backup.json").is_file());
}

#[test]
fn older_credentials_cannot_replace_cli_rotation() {
    let root = tempfile::tempdir().unwrap();
    let old = credentials();
    let mut rotated = old.clone();
    rotated.expires_at += 3_600_000;
    rotated.access_token = "mock-rotated".into();
    native::apply(root.path(), &rotated, &account("sample")).unwrap();
    assert!(matches!(
        native::apply(root.path(), &old, &account("sample")),
        Err(Error::Changed)
    ));
    assert!(native::snapshot(root.path()).unwrap().0 == rotated);
}

#[test]
fn saved_accounts_deduplicate_and_never_return_credentials() {
    let root = tempfile::tempdir().unwrap();
    let id = store::save_login(
        root.path(),
        credentials(),
        account("first"),
        store::LoginTarget::default(),
    )
    .unwrap();
    let same = store::save_login(
        root.path(),
        credentials(),
        account("first"),
        store::LoginTarget::default(),
    )
    .unwrap();
    assert_eq!(id, same);
    let other = store::save_login(
        root.path(),
        credentials(),
        account("second"),
        store::LoginTarget::default(),
    )
    .unwrap();
    assert_ne!(id, other);
    let accounts = store::list_root(root.path()).unwrap();
    assert_eq!(accounts.len(), 2);
    let output = serde_json::to_string(&accounts).unwrap();
    assert!(output.contains("claudeCode"));
    assert!(!output.contains("mock-access") && !output.contains("mock-refresh"));
    let saved = std::fs::read_to_string(
        root.path()
            .join("accounts")
            .join(&id)
            .join("claude-profile.json"),
    )
    .unwrap();
    assert!(!saved.contains("mock-access") && !saved.contains("mock-refresh"));
    assert!(store::read(root.path(), "../escape").is_err());
}

#[test]
fn vault_rejects_tampering_and_another_account() {
    let envelope = vault::seal("account-a", &json!({ "token": "mock-secret" })).unwrap();
    assert!(!envelope.to_string().contains("mock-secret"));
    assert_eq!(
        vault::open("account-a", &envelope).unwrap()["token"],
        "mock-secret"
    );
    assert!(vault::open("account-b", &envelope).is_err());
}

#[test]
fn refresh_rotation_uses_mock_network_and_sanitizes_rejection() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/token", server.server_addr());
    let worker = std::thread::spawn(move || {
        for status in [200, 400] {
            let mut request = server.recv().unwrap();
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            let body: Value = serde_json::from_str(&body).unwrap();
            assert_eq!(body["grant_type"], "refresh_token");
            assert_eq!(body["refresh_token"], "mock-refresh");
            let result = if status == 200 {
                json!({ "access_token": "mock-new", "refresh_token": "mock-new-refresh",
                "expires_in": 3600, "scope": "user:profile user:inference" })
            } else {
                json!({ "error": "invalid_grant", "token": "must-not-leak" })
            };
            request
                .respond(
                    tiny_http::Response::from_string(result.to_string()).with_status_code(status),
                )
                .unwrap();
        }
    });
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();
    let rotated = oauth::refresh_at(&client, &endpoint, &credentials()).unwrap();
    assert_eq!(rotated.refresh_token.as_deref(), Some("mock-new-refresh"));
    let error = oauth::refresh_at(&client, &endpoint, &credentials())
        .err()
        .unwrap();
    assert_eq!(error.to_string(), "client.officialAccounts.signInRequired");
    worker.join().unwrap();
}

#[test]
fn authorization_code_exchange_binds_verifier_and_reads_profile() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", server.server_addr());
    let pkce = oauth::pkce().unwrap();
    let verifier = pkce.verifier.clone();
    let state = pkce.state.clone();
    let worker = std::thread::spawn(move || {
        let mut request = server.recv().unwrap();
        let mut body = String::new();
        request.as_reader().read_to_string(&mut body).unwrap();
        let body: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["code_verifier"], verifier);
        assert_eq!(body["state"], state);
        assert_eq!(body["code"], "mock-code");
        assert_eq!(body["grant_type"], "authorization_code");
        request.respond(tiny_http::Response::from_string(json!({
            "access_token": "mock-access", "refresh_token": "mock-refresh", "expires_in": 3600
        }).to_string())).unwrap();
        let request = server.recv().unwrap();
        assert!(request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Authorization")
                && header.value.as_str() == "Bearer mock-access"));
        request
            .respond(tiny_http::Response::from_string(
                json!({
                    "account": { "uuid": "mock-user", "email": "mock@example.com" },
                    "organization": { "uuid": "mock-org", "organization_type": "claude_pro" }
                })
                .to_string(),
            ))
            .unwrap();
    });
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();
    let (credentials, profile) =
        oauth::exchange_at(&client, (&endpoint, &endpoint), &pkce, "mock-code").unwrap();
    assert!(!credentials.expiring());
    assert_eq!(
        oauth::account_config(&profile).unwrap()["emailAddress"],
        "mock@example.com"
    );
    worker.join().unwrap();
}

#[test]
fn failed_selection_rolls_back_only_our_authentication_write() {
    let directory = tempfile::tempdir().unwrap();
    native::apply(directory.path(), &credentials(), &account("old")).unwrap();
    let before = native::snapshot(directory.path()).unwrap();
    let result =
        native::apply_and_commit(directory.path(), &credentials(), &account("new"), || {
            Err(Error::Storage)
        });
    assert!(matches!(result, Err(Error::Storage)));
    assert_eq!(native::snapshot(directory.path()).unwrap().1, before.1);
    assert!(native::snapshot(directory.path()).unwrap().0 == before.0);
}

#[test]
fn account_list_does_not_need_credential_decryption() {
    let root = tempfile::tempdir().unwrap();
    let id = store::save_login(
        root.path(),
        credentials(),
        account("sample"),
        store::LoginTarget::default(),
    )
    .unwrap();
    let path = root
        .path()
        .join("accounts")
        .join(&id)
        .join("claude-profile.json");
    let mut value = native::read_json(&path).unwrap();
    value["oauth"] = json!({ "unavailable": true });
    native::write_json(&path, &value).unwrap();
    assert_eq!(store::list_root(root.path()).unwrap().len(), 1);
    assert!(store::read(root.path(), &id).is_err());
}

#[test]
fn import_copies_authentication_to_an_isolated_profile_without_modifying_the_source() {
    let root = tempfile::tempdir().unwrap();
    let cli = tempfile::tempdir().unwrap();
    native::apply(cli.path(), &credentials(), &account("imported")).unwrap();
    let before = native::read_credentials(cli.path()).unwrap();
    let id = store::import_directory(root.path(), cli.path()).unwrap();
    let saved = store::read(root.path(), &id).unwrap();
    assert!(saved
        .config_dir
        .starts_with(root.path().join("claude-profiles")));
    assert_eq!(saved.email, "imported@example.com");
    assert_eq!(native::read_credentials(cli.path()).unwrap(), before);
    assert_eq!(
        native::snapshot(&saved.config_dir).unwrap().1,
        account("imported")
    );
}
