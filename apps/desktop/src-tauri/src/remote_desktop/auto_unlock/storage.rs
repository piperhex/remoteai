use super::Error;
use crate::desktop_service::configuration;
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

pub(super) const REQUEST: &str = "unlock-request.bin";
pub(super) const RESULT: &str = "unlock-result.bin";
const SETTINGS: &str = "unlock-settings.bin";
const MAX_BYTES: u64 = 16384;

#[derive(Deserialize, Serialize)]
pub(super) struct Credentials {
    pub owner_sid: String,
    pub device_id: String,
    pub service_binding: String,
    pub username: String,
    pub password: String,
    // Persist before submission. A crash or failure must not cause repeated password attempts.
    pub blocked: bool,
    pub pending: Option<Attempt>,
}
impl Drop for Credentials {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
#[derive(Deserialize, Serialize)]
pub(super) struct Attempt {
    pub nonce: [u8; 16],
    pub expires: u64,
    pub session: u32,
}

pub(super) fn path(name: &str) -> Result<PathBuf, Error> {
    Ok(configuration::data_root()
        .map_err(|_| Error::Storage)?
        .join(name))
}
pub(super) fn read_bytes(name: &str) -> Result<Option<Vec<u8>>, Error> {
    read_path(&path(name)?)
}
fn read_path(path: &Path) -> Result<Option<Vec<u8>>, Error> {
    use std::os::windows::fs::MetadataExt;
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::Storage),
    };
    if metadata.len() > MAX_BYTES || metadata.file_attributes() & 0x400 != 0 || !metadata.is_file()
    {
        return Err(Error::Storage);
    }
    std::fs::read(path).map(Some).map_err(|_| Error::Storage)
}
pub(super) fn load() -> Result<Option<Credentials>, Error> {
    load_from(&path(SETTINGS)?)
}
fn load_from(path: &Path) -> Result<Option<Credentials>, Error> {
    let Some(mut bytes) = read_path(path)? else {
        return Ok(None);
    };
    let plain =
        Zeroizing::new(configuration::protect(&mut bytes, false).map_err(|_| Error::Storage)?);
    serde_json::from_slice(&plain)
        .map(Some)
        .map_err(|_| Error::Storage)
}
pub(super) fn save(value: &Credentials) -> Result<(), Error> {
    save_to(&path(SETTINGS)?, value)
}
fn save_to(path: &Path, value: &Credentials) -> Result<(), Error> {
    let mut bytes = Zeroizing::new(serde_json::to_vec(value).map_err(|_| Error::Storage)?);
    let encrypted = configuration::protect(&mut bytes, true).map_err(|_| Error::Storage)?;
    write(path, &encrypted)
}
pub(super) fn seal(name: &str, bytes: &mut [u8]) -> Result<(), Error> {
    let encrypted = configuration::protect(bytes, true).map_err(|_| Error::Storage)?;
    write(&path(name)?, &encrypted)
}
fn write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let temporary = path
        .parent()
        .ok_or(Error::Storage)?
        .join(format!(".unlock-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| Error::Storage)?;
        file.write_all(bytes).map_err(|_| Error::Storage)?;
        file.sync_all().map_err(|_| Error::Storage)?;
        drop(file);
        crate::storage::replace_file(&temporary, path).map_err(|_| Error::Storage)
    })();
    if result.is_err() && temporary.exists() && std::fs::remove_file(&temporary).is_err() {
        eprintln!("automatic unlock temporary cleanup failed");
    }
    result
}
pub(super) fn remove(name: &str) -> Result<(), Error> {
    match std::fs::remove_file(path(name)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(Error::Storage),
    }
}
pub(super) fn cancel() -> Result<(), Error> {
    for name in [REQUEST, "unlock-claimed.bin", RESULT, "unlock-result.tmp"] {
        remove(name)?;
    }
    Ok(())
}
pub(super) fn clear() -> Result<(), Error> {
    cancel()?;
    remove(SETTINGS)
}

pub(super) fn request_bytes(credentials: &Credentials, attempt: &Attempt) -> Zeroizing<Vec<u8>> {
    let mut bytes = Zeroizing::new(b"CSWULK01".to_vec());
    bytes.extend_from_slice(&attempt.session.to_le_bytes());
    bytes.extend_from_slice(&attempt.expires.to_le_bytes());
    bytes.extend_from_slice(&attempt.nonce);
    for text in [
        &credentials.username,
        &credentials.password,
        &credentials.owner_sid,
    ] {
        bytes.extend_from_slice(&(text.encode_utf16().count() as u32).to_le_bytes());
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_password_survives_reopening_and_replacement_on_the_host() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(SETTINGS);
        assert!(load_from(&path).unwrap().is_none());
        let value = Credentials {
            owner_sid: "S-1-5-21-1001".into(),
            device_id: "fixture".into(),
            service_binding: "binding".into(),
            username: "PC\\alice".into(),
            password: "fixture-password".into(),
            blocked: false,
            pending: None,
        };
        save_to(&path, &value).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes
            .windows(value.password.len())
            .any(|part| part == value.password.as_bytes()));
        drop(value);
        let mut reopened = load_from(&path).unwrap().unwrap();
        assert_eq!(reopened.username, "PC\\alice");
        assert_eq!(reopened.password, "fixture-password");
        assert!(!reopened.blocked);
        reopened.password = "replacement-password".into();
        save_to(&path, &reopened).unwrap();
        drop(reopened);
        assert_eq!(
            load_from(&path).unwrap().unwrap().password,
            "replacement-password"
        );
        std::fs::remove_file(&path).unwrap();
        assert!(load_from(&path).unwrap().is_none());
    }
    #[test]
    fn stored_credentials_are_encrypted_and_tampering_is_rejected() {
        let credentials = Credentials {
            owner_sid: "S-1-5-21-1001".into(),
            device_id: "device".into(),
            service_binding: "binding".into(),
            username: "PC\\alice".into(),
            password: "fixture-password".into(),
            blocked: true,
            pending: None,
        };
        let mut plain = Zeroizing::new(serde_json::to_vec(&credentials).unwrap());
        let encrypted = configuration::protect(&mut plain, true).unwrap();
        assert!(!encrypted
            .windows(credentials.password.len())
            .any(|part| part == credentials.password.as_bytes()));
        let mut input = encrypted.clone();
        let decoded = Zeroizing::new(configuration::protect(&mut input, false).unwrap());
        let restored: Credentials = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(restored.password, credentials.password);
        assert!(restored.blocked);
        input = encrypted;
        let middle = input.len() / 2;
        input[middle] ^= 1;
        assert!(configuration::protect(&mut input, false).is_err());
    }
    #[test]
    fn credential_request_uses_the_provider_wire_format() {
        let credentials = Credentials {
            owner_sid: "S-1-5-21-1001".into(),
            device_id: "device".into(),
            service_binding: "binding".into(),
            username: "PC\\alice".into(),
            password: " 密码🔑 ".into(),
            blocked: false,
            pending: None,
        };
        let attempt = Attempt {
            nonce: [7; 16],
            expires: 110,
            session: 4,
        };
        let bytes = request_bytes(&credentials, &attempt);
        assert_eq!(&bytes[..8], b"CSWULK01");
        assert_eq!(&bytes[8..12], &4u32.to_le_bytes());
        assert_eq!(&bytes[12..20], &110u64.to_le_bytes());
        assert_eq!(&bytes[20..36], &[7; 16]);
        let mut offset = 36;
        for expected in [
            &credentials.username,
            &credentials.password,
            &credentials.owner_sid,
        ] {
            let count = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            let (pairs, _) = bytes[offset..offset + count * 2].as_chunks::<2>();
            let units: Vec<_> = pairs.iter().copied().map(u16::from_le_bytes).collect();
            assert_eq!(String::from_utf16(&units).unwrap(), *expected);
            offset += count * 2;
        }
        assert_eq!(offset, bytes.len());
    }
}
