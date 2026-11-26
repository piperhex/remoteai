//! Bind ephemeral chat keys to a persistent host identity kept in the operating-system credential store.
#[cfg(not(target_os = "linux"))]
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use std::sync::Mutex;

static IDENTITY: Mutex<()> = Mutex::new(());
#[cfg(target_os = "linux")]
mod linux;
#[derive(Debug, thiserror::Error)]
enum IdentityError {
    #[cfg(target_os = "linux")]
    #[error(transparent)]
    Keyring(#[from] linux::KeyringIssue),
    #[error("电脑身份暂时无法读取，请重启应用后重试。")]
    Storage,
    #[error("连接信息无效，请重新连接。")]
    Invalid,
}
fn key() -> Result<SigningKey, IdentityError> {
    let _guard = IDENTITY.lock().map_err(|_| IdentityError::Storage)?;
    stored_key()
}

#[cfg(target_os = "linux")]
fn stored_key() -> Result<SigningKey, IdentityError> {
    Ok(linux::stored_key()?)
}

#[cfg(not(target_os = "linux"))]
fn stored_key() -> Result<SigningKey, IdentityError> {
    let entry = keyring::Entry::new("codex-switch.remote-chat", "host-identity-v1")
        .map_err(|_| IdentityError::Storage)?;
    let mut secret: [u8; 32] = match entry.get_password() {
        Ok(value) => STANDARD
            .decode(value)
            .map_err(|_| IdentityError::Storage)?
            .try_into()
            .map_err(|_| IdentityError::Storage)?,
        Err(keyring::Error::NoEntry) => {
            let value: [u8; 32] = rand::random();
            entry
                .set_password(&STANDARD.encode(value))
                .map_err(|_| IdentityError::Storage)?;
            value
        }
        Err(_) => return Err(IdentityError::Storage),
    };
    let key = SigningKey::from_bytes(&secret);
    secret.fill(0);
    Ok(key)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn prepare_chat_keyring(window: tauri::Webview) -> Result<(), String> {
    if window.label() != "main" {
        return Err(IdentityError::Invalid.to_string());
    }
    tauri::async_runtime::spawn_blocking(|| {
        linux::prepare().map_err(|issue| issue.to_string())?;
        key().map(|_| ()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| IdentityError::Storage.to_string())?
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
#[cfg(windows)]
pub(crate) fn export_private_key() -> Result<[u8; 32], String> {
    key()
        .map(|key| key.to_bytes())
        .map_err(|_| "电脑身份暂时无法读取，请重试。".into())
}

pub(super) fn sign(session: &str, payload: &mut Value) -> Result<(), String> {
    sign_key(session, payload).map_err(|error| error.to_string())
}
fn sign_key(session: &str, payload: &mut Value) -> Result<(), IdentityError> {
    if payload["kind"] != "key" {
        return Ok(());
    }
    let ephemeral = payload["key"].as_str().ok_or(IdentityError::Invalid)?;
    if ephemeral.len() != 64 || !ephemeral.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(IdentityError::Invalid);
    }
    let key = key()?;
    let context = format!("codex-switch-host-v1:{session}:{ephemeral}");
    payload["identity"] = json!({"key":hex(key.verifying_key().as_bytes()),
        "signature":hex(&key.sign(context.as_bytes()).to_bytes())});
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_chat_identity(window: tauri::Webview) -> Result<String, String> {
    if window.label() != "main" {
        return Err(IdentityError::Invalid.to_string());
    }
    tauri::async_runtime::spawn_blocking(|| key().map(|key| hex(key.verifying_key().as_bytes())))
        .await
        .map_err(|_| IdentityError::Storage.to_string())?
        .map_err(|error| error.to_string())
}
