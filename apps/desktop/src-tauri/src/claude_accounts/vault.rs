use super::{Error, Result};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use zeroize::Zeroizing;

#[cfg(not(test))]
fn key() -> Result<Zeroizing<[u8; 32]>> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|_| Error::Busy)?;
    let entry = keyring::Entry::new("remoteai.claude-accounts", "encryption-v1")
        .map_err(|_| Error::Keychain)?;
    match entry.get_password() {
        Ok(encoded) => {
            let encoded = Zeroizing::new(encoded);
            let decoded = Zeroizing::new(
                STANDARD
                    .decode(encoded.as_bytes())
                    .map_err(|_| Error::Keychain)?,
            );
            Ok(Zeroizing::new(
                decoded.as_slice().try_into().map_err(|_| Error::Keychain)?,
            ))
        }
        Err(keyring::Error::NoEntry) => {
            let key = Zeroizing::new(rand::random::<[u8; 32]>());
            entry
                .set_password(&Zeroizing::new(STANDARD.encode(key.as_ref())))
                .map_err(|_| Error::Keychain)?;
            Ok(key)
        }
        Err(_) => Err(Error::Keychain),
    }
}

#[cfg(test)]
fn key() -> Result<Zeroizing<[u8; 32]>> {
    // Tests cannot access the user's OS credential store.
    Ok(Zeroizing::new([83; 32]))
}

pub(super) fn seal(id: &str, value: &Value) -> Result<Value> {
    let plaintext = Zeroizing::new(serde_json::to_vec(value).map_err(|_| Error::Storage)?);
    let cipher = Aes256Gcm::new_from_slice(key()?.as_ref()).map_err(|_| Error::Keychain)?;
    let nonce = rand::random::<[u8; 12]>();
    let data = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: id.as_bytes(),
            },
        )
        .map_err(|_| Error::Storage)?;
    Ok(json!({ "nonce": STANDARD.encode(nonce), "data": STANDARD.encode(data) }))
}

pub(super) fn open(id: &str, value: &Value) -> Result<Value> {
    let nonce = STANDARD
        .decode(value["nonce"].as_str().ok_or(Error::Storage)?)
        .map_err(|_| Error::Storage)?;
    if nonce.len() != 12 {
        return Err(Error::Storage);
    }
    let data = STANDARD
        .decode(value["data"].as_str().ok_or(Error::Storage)?)
        .map_err(|_| Error::Storage)?;
    let cipher = Aes256Gcm::new_from_slice(key()?.as_ref()).map_err(|_| Error::Keychain)?;
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &data,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| Error::Storage)?,
    );
    serde_json::from_slice(&plain).map_err(|_| Error::Storage)
}
