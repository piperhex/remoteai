use super::{
    native, oauth,
    store::{self, Profile},
    Error, Result,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
static SWITCH: Mutex<()> = Mutex::new(());

pub(super) fn deactivate(root: &Path) -> Result<()> {
    let _switch = SWITCH.lock().map_err(|_| Error::Busy)?;
    let _mutation = store::MUTATION.lock().map_err(|_| Error::Busy)?;
    store::select(root, None)
}

fn account_lock(root: &Path, id: &str) -> Result<Arc<Mutex<()>>> {
    if !store::is_claude_id(id) {
        return Err(Error::Invalid);
    }
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| Error::Busy)?;
    Ok(locks.entry(root.join(id)).or_default().clone())
}

pub(super) fn refresh(root: &Path, id: &str, for_switch: bool) -> Result<Profile> {
    let lock = account_lock(root, id)?;
    let _guard = lock.lock().map_err(|_| Error::Busy)?;
    let mut profile = store::read(root, id)?;
    let result = update(root, &mut profile, for_switch);
    if let Err(error) = &result {
        profile.error = Some(error.to_string());
    }
    profile.checked_at = chrono::Utc::now().to_rfc3339();
    commit(root, &mut profile)?;
    result?;
    Ok(profile)
}

fn commit(root: &Path, profile: &mut Profile) -> Result<()> {
    let _guard = store::MUTATION.lock().map_err(|_| Error::Busy)?;
    if store::read(root, &profile.id)?.revision != profile.revision {
        return Err(Error::Changed);
    }
    profile.revision += 1;
    store::save(root, profile)
}

fn adopt_newer(profile: &mut Profile, directory: &Path) -> Result<bool> {
    let (credentials, account) = match native::snapshot(directory) {
        Ok(snapshot) => snapshot,
        Err(Error::SignedOut) => return Ok(false),
        Err(error) => return Err(error),
    };
    if native::same_account(&account, &profile.oauth_account)
        && credentials.newer_than(&profile.oauth)
    {
        profile.oauth = credentials;
        return Ok(true);
    }
    Ok(false)
}

fn update(root: &Path, profile: &mut Profile, for_switch: bool) -> Result<()> {
    let directory = profile.config_dir.clone();
    adopt_newer(profile, &directory)?;
    let default = native::default_directory()?;
    if store::selected(root).as_deref() == Some(&profile.id) {
        adopt_newer(profile, &default)?;
    }
    if profile.oauth.expiring() {
        match oauth::refresh(&profile.oauth) {
            Ok(credentials) => {
                profile.oauth = credentials;
                // Commit rotation before profile queries or native synchronization can fail.
                commit(root, profile)?;
            }
            Err(error) => {
                if !adopt_newer(profile, &directory)? && !adopt_newer(profile, &default)? {
                    return Err(error);
                }
            }
        }
    }
    let data = oauth::profile(&profile.oauth.access_token)?;
    let account = oauth::account_config(&data)?;
    if !native::same_account(&profile.oauth_account, &account) {
        return Err(Error::State);
    }
    profile.email = account["emailAddress"]
        .as_str()
        .ok_or(Error::Login)?
        .to_owned();
    profile.oauth_account = account;
    if let Some(plan) = data["organization"]["organization_type"].as_str() {
        profile.plan = plan.to_string();
    }
    profile.error = None;
    native::apply(&directory, &profile.oauth, &profile.oauth_account)?;
    if !for_switch {
        sync_default(root, profile, &default)?;
    }
    Ok(())
}

fn sync_default(root: &Path, profile: &Profile, directory: &Path) -> Result<()> {
    // Serialize the selection check and write with activation so a late refresh cannot undo a switch.
    let _switch = SWITCH.lock().map_err(|_| Error::Busy)?;
    if store::selected(root).as_deref() != Some(&profile.id) {
        return Ok(());
    }
    let current = native::read_json(&native::config_path(directory)?)?;
    if native::same_account(&current["oauthAccount"], &profile.oauth_account) {
        native::apply(directory, &profile.oauth, &profile.oauth_account)?;
    }
    Ok(())
}

pub(super) fn activate(root: &Path, id: &str) -> Result<()> {
    let profile = refresh(root, id, true)?;
    let _switch = SWITCH.lock().map_err(|_| Error::Busy)?;
    let _mutation = store::MUTATION.lock().map_err(|_| Error::Busy)?;
    if store::read(root, id)?.revision != profile.revision {
        return Err(Error::Changed);
    }
    native::apply_and_commit(
        &native::default_directory()?,
        &profile.oauth,
        &profile.oauth_account,
        || store::select(root, Some(id)),
    )
}
