use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::SigningKey;
use secret_service::blocking::{Item, SecretService};
use secret_service::{EncryptionType, Error};
use std::collections::HashMap;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub(super) enum KeyringIssue {
    #[error("KEYRING_SERVICE")]
    Service,
    #[error("KEYRING_SERVICE_DEBIAN")]
    Debian,
    #[error("KEYRING_SERVICE_FEDORA")]
    Fedora,
    #[error("KEYRING_SERVICE_ARCH")]
    Arch,
    #[error("KEYRING_CREATE")]
    Create,
    #[error("KEYRING_LOCKED")]
    Locked,
    #[error("KEYRING_ACCESS")]
    Access,
}

fn connect() -> Result<SecretService<'static>, KeyringIssue> {
    SecretService::connect(EncryptionType::Dh).map_err(|_| {
        let release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
        service_issue(&release)
    })
}

fn service_issue(release: &str) -> KeyringIssue {
    for line in release.lines() {
        let Some(("ID" | "ID_LIKE", value)) = line.split_once('=') else {
            continue;
        };
        for id in value.trim_matches(['"', '\'']).split_whitespace() {
            match id {
                "ubuntu" | "debian" => return KeyringIssue::Debian,
                "fedora" | "rhel" => return KeyringIssue::Fedora,
                "arch" => return KeyringIssue::Arch,
                _ => {}
            }
        }
    }
    KeyringIssue::Service
}

// Match the attributes and base64 representation written by keyring v4 in earlier releases.
fn attributes() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("service", "codex-switch.remote-chat"),
        ("username", "host-identity-v1"),
    ])
}

fn existing<'a>(service: &'a SecretService<'a>) -> Result<Option<Item<'a>>, KeyringIssue> {
    let found = service
        .search_items(attributes())
        .map_err(|_| KeyringIssue::Access)?;
    let mut items = found.unlocked.into_iter().chain(found.locked);
    let first = items.next();
    if items.next().is_some() {
        return Err(KeyringIssue::Access);
    }
    Ok(first)
}

fn read(item: Item<'_>) -> Result<SigningKey, KeyringIssue> {
    if item.is_locked().map_err(|_| KeyringIssue::Access)? {
        return Err(KeyringIssue::Locked);
    }
    let encoded = Zeroizing::new(item.get_secret().map_err(|_| KeyringIssue::Access)?);
    let raw = Zeroizing::new(
        STANDARD
            .decode(&encoded[..])
            .map_err(|_| KeyringIssue::Access)?,
    );
    Ok(SigningKey::from_bytes(
        raw.as_slice()
            .try_into()
            .map_err(|_| KeyringIssue::Access)?,
    ))
}

pub(super) fn stored_key() -> Result<SigningKey, KeyringIssue> {
    let service = connect()?;
    if let Some(item) = existing(&service)? {
        return read(item);
    }
    let collection = service
        .get_default_collection()
        .map_err(|error| match error {
            Error::NoResult => KeyringIssue::Create,
            _ => KeyringIssue::Access,
        })?;
    if collection.is_locked().map_err(|_| KeyringIssue::Access)? {
        return Err(KeyringIssue::Locked);
    }
    let bytes = Zeroizing::new(rand::random::<[u8; 32]>());
    let encoded = Zeroizing::new(STANDARD.encode(&bytes[..]));
    let mut attrs = attributes();
    attrs.insert("xdg:schema", "org.freedesktop.Secret.Generic");
    collection
        .create_item("Remote AI", attrs, encoded.as_bytes(), false, "text/plain")
        .map_err(|_| KeyringIssue::Access)?;
    Ok(SigningKey::from_bytes(&bytes))
}

/// Called only by a local user gesture. The system service owns the password prompt.
pub(super) fn prepare() -> Result<(), KeyringIssue> {
    prepare_wsl_prompt()?;
    let service = connect()?;
    if let Some(item) = existing(&service)? {
        if item.is_locked().map_err(|_| KeyringIssue::Access)? {
            item.unlock().map_err(|_| KeyringIssue::Locked)?;
        }
        return Ok(());
    }
    let collection = match service.get_default_collection() {
        Ok(collection) => collection,
        Err(Error::NoResult) => service
            .create_collection("Remote AI", "default")
            .map_err(|_| KeyringIssue::Create)?,
        Err(_) => return Err(KeyringIssue::Access),
    };
    if collection.is_locked().map_err(|_| KeyringIssue::Access)? {
        collection.unlock().map_err(|_| KeyringIssue::Locked)?;
    }
    Ok(())
}

/// WSLg exports its display to applications, but the session bus can start before that display exists.
fn prepare_wsl_prompt() -> Result<(), KeyringIssue> {
    if std::env::var_os("WSL_DISTRO_NAME").is_none() {
        return Ok(());
    }
    let variables: Vec<_> = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"]
        .into_iter()
        .filter(|name| std::env::var_os(name).is_some())
        .collect();
    if variables.is_empty() {
        return Ok(());
    }
    let mut command = std::process::Command::new("/usr/bin/dbus-update-activation-environment");
    if std::env::var_os("XDG_RUNTIME_DIR")
        .is_some_and(|dir| std::path::Path::new(&dir).join("systemd/private").exists())
    {
        command.arg("--systemd");
    }
    let status = command
        .args(variables)
        .status()
        .map_err(|_| KeyringIssue::Access)?;
    if status.success() {
        Ok(())
    } else {
        Err(KeyringIssue::Access)
    }
}
