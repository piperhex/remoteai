use super::{credentials::Credentials, native, vault, Error, Result};
use crate::{
    models::{AccountSummary, UsageSummary},
    storage::*,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(super) static MUTATION: Mutex<()> = Mutex::new(());
const PROFILE_FILE: &str = "claude-profile.json";
const SELECTION_FILE: &str = "claude-selection.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Profile {
    pub id: String,
    pub config_dir: PathBuf,
    pub email: String,
    pub organization_id: Option<String>,
    pub plan: String,
    pub checked_at: String,
    pub error: Option<String>,
    pub oauth: Credentials,
    pub oauth_account: Value,
    pub revision: u64,
}

pub(crate) fn is_claude_id(id: &str) -> bool {
    id.strip_prefix("claude_")
        .is_some_and(|value| value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn profile_path(root: &Path, id: &str) -> Result<PathBuf> {
    if !is_claude_id(id) {
        return Err(Error::Invalid);
    }
    Ok(root.join("accounts").join(id).join(PROFILE_FILE))
}

pub(super) fn read(root: &Path, id: &str) -> Result<Profile> {
    let mut value = native::read_json(&profile_path(root, id)?)?;
    value["oauth"] = vault::open(id, &value["oauth"])?;
    let profile: Profile = serde_json::from_value(value).map_err(|_| Error::Storage)?;
    if profile.id != id || !profile.config_dir.is_absolute() {
        return Err(Error::Invalid);
    }
    Ok(profile)
}

pub(super) fn save(root: &Path, profile: &Profile) -> Result<()> {
    let mut value = serde_json::to_value(profile).map_err(|_| Error::Storage)?;
    value["oauth"] = vault::seal(&profile.id, &value["oauth"])?;
    native::write_json(&profile_path(root, &profile.id)?, &value)
}

pub(super) fn selected(root: &Path) -> Option<String> {
    read_json(&root.join(SELECTION_FILE))
        .ok()?
        .get("id")?
        .as_str()
        .map(str::to_owned)
}

pub(super) fn select(root: &Path, id: Option<&str>) -> Result<()> {
    if let Some(id) = id {
        metadata(root, id)?;
    }
    native::write_json(&root.join(SELECTION_FILE), &serde_json::json!({ "id": id }))
}

pub(super) fn new_id() -> String {
    format!("claude_{}", uuid::Uuid::new_v4().simple())
}

#[derive(Default)]
pub(super) struct LoginTarget<'a> {
    pub directory: Option<PathBuf>,
    pub expected: Option<&'a str>,
}

pub(super) fn save_login(
    root: &Path,
    oauth: Credentials,
    account: Value,
    target: LoginTarget<'_>,
) -> Result<String> {
    if ["accountUuid", "organizationUuid", "emailAddress"]
        .iter()
        .any(|key| {
            account[*key]
                .as_str()
                .is_none_or(|value| value.trim().is_empty())
        })
    {
        return Err(Error::SignedOut);
    }
    let _guard = MUTATION.lock().map_err(|_| Error::Busy)?;
    let previous = if let Some(id) = target.expected {
        Some(read(root, id)?)
    } else {
        profiles(root)?
            .into_iter()
            .find(|profile| native::same_account(&profile.oauth_account, &account))
    };
    if previous
        .as_ref()
        .is_some_and(|profile| !native::same_account(&profile.oauth_account, &account))
    {
        return Err(Error::State);
    }
    let id = previous
        .as_ref()
        .map(|value| value.id.clone())
        .unwrap_or_else(new_id);
    let config_dir = previous
        .as_ref()
        .map(|value| value.config_dir.clone())
        .or(target.directory)
        .unwrap_or_else(|| root.join("claude-profiles").join(&id));
    let profile = Profile {
        id: id.clone(),
        config_dir,
        email: account["emailAddress"]
            .as_str()
            .ok_or(Error::SignedOut)?
            .to_string(),
        organization_id: account["organizationUuid"].as_str().map(str::to_owned),
        plan: oauth.subscription_type.clone().unwrap_or_default(),
        oauth,
        oauth_account: account,
        revision: previous.map(|value| value.revision + 1).unwrap_or(1),
        checked_at: chrono::Utc::now().to_rfc3339(),
        error: None,
    };
    native::apply_and_commit(
        &profile.config_dir,
        &profile.oauth,
        &profile.oauth_account,
        || save(root, &profile),
    )?;
    Ok(id)
}

pub(super) fn import_current(root: &Path) -> Result<String> {
    import_directory(root, &native::default_directory()?)
}

pub(super) fn import_directory(root: &Path, directory: &Path) -> Result<String> {
    let (credentials, account) = native::snapshot(directory)?;
    // Keep managed CLI instances isolated from future changes to the user's default profile.
    save_login(root, credentials, account, LoginTarget::default())
}

pub(super) fn refresh(root: &Path, id: &str) -> Result<AccountSummary> {
    super::refresh::refresh(root, id, false)?;
    summary(root, metadata(root, id)?)
}

pub(super) fn activate(root: &Path, id: &str) -> Result<()> {
    super::refresh::activate(root, id)
}

pub(super) fn delete(root: &Path, id: &str) -> Result<()> {
    let _guard = MUTATION.lock().map_err(|_| Error::Busy)?;
    if selected(root).as_deref() == Some(id) {
        return Err(Error::Busy);
    }
    // Running CLI sessions retain their native profile and history; deletion removes the saved credential snapshot.
    fs::remove_file(profile_path(root, id)?).map_err(|_| Error::Storage)
}

fn profiles(root: &Path) -> Result<Vec<Profile>> {
    let accounts = root.join("accounts");
    if !accounts.exists() {
        return Ok(Vec::new());
    }
    let mut profiles = Vec::new();
    for entry in fs::read_dir(accounts).map_err(|_| Error::Storage)? {
        let entry = entry.map_err(|_| Error::Storage)?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if is_claude_id(&id) && entry.path().join(PROFILE_FILE).is_file() {
            profiles.push(read(root, &id)?);
        }
    }
    Ok(profiles)
}

pub(super) fn list_root(root: &Path) -> Result<Vec<AccountSummary>> {
    let directory = root.join("accounts");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut accounts = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| Error::Storage)? {
        let entry = entry.map_err(|_| Error::Storage)?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if is_claude_id(&id) && entry.path().join(PROFILE_FILE).is_file() {
            accounts.push(summary(root, metadata(root, &id)?)?);
        }
    }
    Ok(accounts)
}

pub(crate) fn list(paths: &Paths) -> std::result::Result<Vec<AccountSummary>, String> {
    let root = paths
        .accounts
        .parent()
        .ok_or_else(|| Error::Storage.to_string())?;
    list_root(root).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    id: String,
    email: String,
    organization_id: Option<String>,
    plan: String,
    checked_at: String,
    error: Option<String>,
}

fn metadata(root: &Path, id: &str) -> Result<Metadata> {
    let value = native::read_json(&profile_path(root, id)?)?;
    let metadata: Metadata = serde_json::from_value(value).map_err(|_| Error::Storage)?;
    if metadata.id != id {
        return Err(Error::Invalid);
    }
    Ok(metadata)
}

fn summary(root: &Path, profile: Metadata) -> Result<AccountSummary> {
    let directory = profile_path(root, &profile.id)?
        .parent()
        .ok_or(Error::Storage)?
        .to_path_buf();
    Ok(AccountSummary {
        account_source: "claudeCode",
        active: selected(root).as_deref() == Some(&profile.id),
        email: profile.email,
        id: profile.id,
        account_id: profile.organization_id,
        plan: profile.plan,
        group: load_account_group(&directory.join("group.txt")),
        note: load_note(&directory.join("note.txt")),
        expires_at: load_expiration(&directory.join("expires-at.txt")),
        private_details: load_account_private_details(&directory.join("private-details.json")),
        auto_switch_enabled: false,
        auto_switch_priority: 0,
        auto_switch_threshold: 0.0,
        local_proxy_compatible: false,
        direct_switch_compatible: true,
        agent_identity: false,
        official: false,
        metadata_editable: true,
        usage: UsageSummary {
            fetched_at: Some(profile.checked_at),
            error: profile.error,
            ..Default::default()
        },
    })
}
