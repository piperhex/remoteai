use super::{credentials::Credentials, Error, Result};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(super) fn default_directory() -> Result<PathBuf> {
    let directory = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".claude")))
        .ok_or(Error::Storage)?;
    if directory.is_absolute() {
        Ok(directory)
    } else {
        Ok(std::env::current_dir()
            .map_err(|_| Error::Storage)?
            .join(directory))
    }
}

pub(super) fn config_path(directory: &Path) -> Result<PathBuf> {
    let legacy = directory.join(".config.json");
    if legacy.exists() {
        return Ok(legacy);
    }
    let home = dirs::home_dir().ok_or(Error::Storage)?;
    if !custom_directory() && directory == home.join(".claude") {
        return Ok(home.join(".claude.json"));
    }
    Ok(directory.join(".claude.json"))
}

fn custom_directory() -> bool {
    std::env::var_os("CLAUDE_CONFIG_DIR").is_some_and(|value| !value.is_empty())
}

pub(super) fn read_json(path: &Path) -> Result<Value> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| Error::Storage)?;
            if !value.is_object() {
                return Err(Error::Storage);
            }
            Ok(value)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err(Error::Storage),
    }
}

/// Named temporary files are private on Unix; replacements inherit the user's profile ACL on Windows.
pub(super) fn write_json(path: &Path, value: &Value) -> Result<()> {
    let parent = path.parent().ok_or(Error::Storage)?;
    fs::create_dir_all(parent).map_err(|_| Error::Storage)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::Storage)?;
    serde_json::to_writer_pretty(&mut temporary, value).map_err(|_| Error::Storage)?;
    temporary.flush().map_err(|_| Error::Storage)?;
    temporary.as_file().sync_all().map_err(|_| Error::Storage)?;
    crate::storage::replace_file(temporary.path(), path).map_err(|_| Error::Storage)
}

pub(super) fn read_credentials(directory: &Path) -> Result<Value> {
    #[cfg(all(target_os = "macos", not(test)))]
    {
        match keychain(directory)?.get_password() {
            Ok(value) => return serde_json::from_str(&value).map_err(|_| Error::Storage),
            Err(keyring::Error::NoEntry) => {}
            // A locked Keychain must never make an old plaintext fallback authoritative.
            Err(_) => return Err(Error::Keychain),
        }
    }
    read_json(&directory.join(".credentials.json"))
}

fn write_credentials(directory: &Path, value: &Value) -> Result<()> {
    #[cfg(all(target_os = "macos", not(test)))]
    {
        keychain(directory)?
            .set_password(&serde_json::to_string(value).map_err(|_| Error::Storage)?)
            .map_err(|_| Error::Keychain)?;
        return Ok(());
    }
    #[cfg(any(not(target_os = "macos"), test))]
    write_json(&directory.join(".credentials.json"), value)
}

#[cfg(all(target_os = "macos", not(test)))]
fn keychain(directory: &Path) -> Result<keyring::Entry> {
    use sha2::{Digest, Sha256};
    let unscoped = !custom_directory()
        && dirs::home_dir().is_some_and(|home| directory == home.join(".claude"));
    let service = if unscoped {
        "Claude Code-credentials".to_string()
    } else {
        let hash = format!(
            "{:x}",
            Sha256::digest(directory.to_string_lossy().as_bytes())
        );
        format!("Claude Code-credentials-{}", &hash[..8])
    };
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .map_err(|_| Error::Keychain)?;
    keyring::Entry::new(&service, &user).map_err(|_| Error::Keychain)
}

pub(super) fn snapshot(directory: &Path) -> Result<(Credentials, Value)> {
    let credentials = read_credentials(directory)?;
    let credentials = Credentials::parse(&credentials["claudeAiOauth"])?;
    let config = read_json(&config_path(directory)?)?;
    let account = config
        .get("oauthAccount")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or(Error::SignedOut)?;
    Ok((credentials, account))
}

pub(super) fn same_account(left: &Value, right: &Value) -> bool {
    ["accountUuid", "organizationUuid"]
        .iter()
        .all(|key| left[*key].as_str().is_some() && left[*key] == right[*key])
}

/// Only authentication fields change. Other settings, MCP servers and project preferences remain byte-equivalent values.
pub(super) fn apply(directory: &Path, oauth: &Credentials, account: &Value) -> Result<()> {
    apply_and_commit(directory, oauth, account, || Ok(()))
}

pub(super) fn apply_and_commit(
    directory: &Path,
    oauth: &Credentials,
    account: &Value,
    commit: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let config_file = config_path(directory)?;
    let old_config = read_json(&config_file)?;
    let old_credentials = read_credentials(directory)?;
    let settings = read_json(&directory.join("settings.json"))?;
    if [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
    ]
    .iter()
    .any(|key| {
        settings["env"][*key]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    }) {
        return Err(Error::Override);
    }
    if same_account(&old_config["oauthAccount"], account) {
        if let Ok(current) = Credentials::parse(&old_credentials["claudeAiOauth"]) {
            if current.newer_than(oauth) {
                return Err(Error::Changed);
            }
        }
    }
    let mut config = old_config.clone();
    config["oauthAccount"] = account.clone();
    config["hasCompletedOnboarding"] = Value::Bool(true);
    let mut credentials = old_credentials.clone();
    credentials["claudeAiOauth"] = serde_json::to_value(oauth).map_err(|_| Error::Storage)?;
    backup(directory, &old_config, &old_credentials)?;
    if read_json(&config_file)? != old_config || read_credentials(directory)? != old_credentials {
        return Err(Error::Changed);
    }
    write_credentials(directory, &credentials)?;
    if let Err(error) = write_json(&config_file, &config).and_then(|()| commit()) {
        // Never overwrite a CLI rotation that occurred after our write while rolling back.
        if read_credentials(directory)? == credentials {
            write_credentials(directory, &old_credentials)?;
        }
        if read_json(&config_file)? == config {
            write_json(&config_file, &old_config)?;
        }
        return Err(error);
    }
    Ok(())
}

fn backup(directory: &Path, config: &Value, credentials: &Value) -> Result<()> {
    write_json(
        &directory.join(".remoteai-account-backup.json"),
        &json!({ "config": config }),
    )?;
    #[cfg(all(target_os = "macos", not(test)))]
    {
        // Keep credential backups in Keychain too; never downgrade macOS secrets to a plaintext file.
        let user = std::env::var("USER").map_err(|_| Error::Keychain)?;
        let service = format!("Remote AI Claude backup {}", directory.display());
        keyring::Entry::new(&service, &user)
            .map_err(|_| Error::Keychain)?
            .set_password(&credentials.to_string())
            .map_err(|_| Error::Keychain)?;
        Ok(())
    }
    #[cfg(any(not(target_os = "macos"), test))]
    write_json(
        &directory.join(".remoteai-credentials-backup.json"),
        credentials,
    )
}
