use super::*;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use std::path::PathBuf;
use zeroize::Zeroizing;

const MAX_CACHE_BYTES: u64 = 8 * 1024 * 1024;
const NONCE_BYTES: usize = 12;

#[derive(Debug, thiserror::Error)]
#[error("SSH cache storage unavailable")]
pub(super) struct CacheError;

fn path<R: Runtime>(app: &tauri::AppHandle<R>, scope: &str) -> Result<PathBuf, CacheError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| CacheError)?
        .join("ssh-cache-v1")
        .join(format!("{scope}.json")))
}

#[cfg(not(test))]
fn key() -> Result<Zeroizing<[u8; 32]>, CacheError> {
    // Serialize key creation so concurrent first-use cache writes share the same encryption key.
    static KEY_LOCK: Mutex<()> = Mutex::new(());
    let _guard = KEY_LOCK.lock().map_err(|_| CacheError)?;
    let entry =
        keyring::Entry::new("codex-switch.ssh-cache", "encryption-v1").map_err(|_| CacheError)?;
    match entry.get_password() {
        Ok(value) => {
            let value = Zeroizing::new(value);
            let bytes = Zeroizing::new(
                BASE64_STANDARD
                    .decode(value.as_bytes())
                    .map_err(|_| CacheError)?,
            );
            Ok(Zeroizing::new(
                bytes.as_slice().try_into().map_err(|_| CacheError)?,
            ))
        }
        Err(keyring::Error::NoEntry) => {
            let key = Zeroizing::new(rand::random::<[u8; 32]>());
            let encoded = Zeroizing::new(BASE64_STANDARD.encode(key.as_ref()));
            entry.set_password(&encoded).map_err(|_| CacheError)?;
            Ok(key)
        }
        Err(_) => Err(CacheError),
    }
}

#[cfg(test)]
fn key() -> Result<Zeroizing<[u8; 32]>, CacheError> {
    // Test fixtures never access or change the user's operating-system credential store.
    Ok(Zeroizing::new([47; 32]))
}

fn seal(scope: &str, cache: &AccountCache) -> Result<Value, CacheError> {
    let plaintext = Zeroizing::new(serde_json::to_vec(cache).map_err(|_| CacheError)?);
    let key = key()?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| CacheError)?;
    let nonce = rand::random::<[u8; NONCE_BYTES]>();
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: scope.as_bytes(),
            },
        )
        .map_err(|_| CacheError)?;
    Ok(json!({"nonce": BASE64_STANDARD.encode(nonce), "data": BASE64_STANDARD.encode(ciphertext)}))
}

fn unseal(scope: &str, envelope: Value) -> Result<AccountCache, CacheError> {
    let nonce = BASE64_STANDARD
        .decode(envelope["nonce"].as_str().ok_or(CacheError)?)
        .map_err(|_| CacheError)?;
    if nonce.len() != NONCE_BYTES {
        return Err(CacheError);
    }
    let data = BASE64_STANDARD
        .decode(envelope["data"].as_str().ok_or(CacheError)?)
        .map_err(|_| CacheError)?;
    let key = key()?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| CacheError)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &data,
                    aad: scope.as_bytes(),
                },
            )
            .map_err(|_| CacheError)?,
    );
    let cache: AccountCache = serde_json::from_slice(&plaintext).map_err(|_| CacheError)?;
    if !cache.valid() {
        return Err(CacheError);
    }
    Ok(cache)
}

pub(super) fn load<R: Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
) -> Result<AccountCache, CacheError> {
    let path = path(app, scope)?;
    match fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AccountCache::default())
        }
        Ok(metadata) if metadata.len() <= MAX_CACHE_BYTES => {}
        _ => return Err(CacheError),
    }
    let bytes = fs::read(path).map_err(|_| CacheError)?;
    unseal(
        scope,
        serde_json::from_slice(&bytes).map_err(|_| CacheError)?,
    )
}

pub(super) fn save<R: Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &str,
    cache: &AccountCache,
) -> Result<(), CacheError> {
    write_json_atomic(&path(app, scope)?, &seal(scope, cache)?).map_err(|_| CacheError)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encryption_binds_account_and_rejects_tampering_without_plaintext_secrets() {
        let cache = super::super::tests::fixture();
        let envelope = seal("account-a", &cache).unwrap();
        assert!(!envelope.to_string().contains("saved-password"));
        assert!(unseal("account-a", envelope.clone()).unwrap().valid());
        assert!(unseal("account-b", envelope.clone()).is_err());
        let mut corrupted = envelope;
        corrupted["data"] = BASE64_STANDARD.encode([0; 40]).into();
        assert!(unseal("account-a", corrupted).is_err());
    }
}
