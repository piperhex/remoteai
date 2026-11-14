//! Device-only browser vault keys. Website WebViews cannot access this command.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, Webview};
use zeroize::{Zeroize, Zeroizing};

const MAX_SCOPE_BYTES: usize = 2048;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RememberedKey {
    salt: String,
    key: String,
}

impl Drop for RememberedKey {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

impl RememberedKey {
    fn valid(&self) -> bool {
        let hex = |text: &str, length| {
            text.len() == length
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        };
        hex(&self.salt, 32) && hex(&self.key, 64)
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Read,
    Write { value: RememberedKey },
    Remove,
}

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("market.invalid")]
    Invalid,
    #[error("market.browserDataStorage")]
    Storage,
}

fn account(identifier: &str, scope: &str) -> Result<String, Error> {
    if scope.is_empty() || scope.len() > MAX_SCOPE_BYTES {
        return Err(Error::Invalid);
    }
    let digest = Sha256::digest(format!("{identifier}\0{scope}").as_bytes());
    Ok(format!("{digest:x}"))
}

fn execute(account: &str, request: Request) -> Result<Option<RememberedKey>, Error> {
    let entry =
        keyring::Entry::new("remoteai.browser-vault.v1", account).map_err(|_| Error::Storage)?;
    match request {
        Request::Read => match entry.get_password() {
            Ok(raw) => {
                let raw = Zeroizing::new(raw);
                let value: RememberedKey =
                    serde_json::from_str(&raw).map_err(|_| Error::Storage)?;
                if !value.valid() {
                    return Err(Error::Storage);
                }
                Ok(Some(value))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Error::Storage),
        },
        Request::Write { value } => {
            if !value.valid() {
                return Err(Error::Invalid);
            }
            let raw = Zeroizing::new(serde_json::to_string(&value).map_err(|_| Error::Storage)?);
            entry.set_password(&raw).map_err(|_| Error::Storage)?;
            Ok(None)
        }
        Request::Remove => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Error::Storage),
        },
    }
}

#[tauri::command]
pub(crate) async fn browser_vault_key(
    webview: Webview,
    scope: String,
    request: Request,
) -> Result<Option<RememberedKey>, String> {
    if webview.label() != "main" {
        return Err(Error::Invalid.to_string());
    }
    let account =
        account(&webview.config().identifier, &scope).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || execute(&account, request))
        .await
        .map_err(|_| Error::Storage.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remembered_keys_are_validated_and_bound_to_app_and_account() {
        assert_ne!(
            account("app", "alice").unwrap(),
            account("app", "bob").unwrap()
        );
        assert_ne!(
            account("test", "alice").unwrap(),
            account("app", "alice").unwrap()
        );
        assert!(account("app", "").is_err());
        assert!(RememberedKey {
            salt: "ab".repeat(16),
            key: "cd".repeat(32)
        }
        .valid());
        assert!(!RememberedKey {
            salt: "ab".repeat(16),
            key: "not-a-key".into()
        }
        .valid());
    }
}
