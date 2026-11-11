//! Account/revision-scoped host cache. Its serialized form is always encrypted.
use super::*;
use std::collections::HashMap;
use std::sync::{atomic::AtomicU64, Arc};

mod disk;

#[derive(Default)]
pub(crate) struct SessionCache {
    data: Mutex<Option<(String, AccountCache)>>,
    requests: AtomicU64,
    refreshing: Mutex<HashSet<String>>,
}

pub(super) fn next_generation(credentials: &CloudCredentials) -> u64 {
    credentials.session.as_ref().map_or(0, |session| {
        session
            .epoch
            .ssh_cache
            .requests
            .fetch_add(1, Ordering::Relaxed)
            + 1
    })
}

pub(super) struct RefreshLease {
    epoch: Arc<credential_session::SessionEpoch>,
    target: String,
}

pub(super) fn start_refresh(credentials: &CloudCredentials, target: &str) -> Option<RefreshLease> {
    let epoch = credentials.session.as_ref()?.epoch.clone();
    if !epoch
        .ssh_cache
        .refreshing
        .lock()
        .ok()?
        .insert(target.to_owned())
    {
        return None;
    }
    Some(RefreshLease {
        epoch,
        target: target.to_owned(),
    })
}

impl Drop for RefreshLease {
    fn drop(&mut self) {
        match self.epoch.ssh_cache.refreshing.lock() {
            Ok(mut running) => {
                running.remove(&self.target);
            }
            Err(_) => eprintln!("SSH background refresh state unavailable"),
        }
    }
}

impl std::fmt::Debug for SessionCache {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SessionCache")
    }
}

#[derive(Default, Deserialize, Serialize)]
pub(super) struct AccountCache {
    #[serde(skip)]
    generation: u64,
    profiles: Option<Vec<SshProfile>>,
    credentials: HashMap<String, CachedCredentials>,
}

#[derive(Deserialize, Serialize)]
struct CachedCredentials {
    revision: u64,
    secret: SshCredentials,
}

impl AccountCache {
    pub(super) fn profiles(&self) -> Option<Vec<SshProfile>> {
        self.profiles.clone()
    }

    pub(super) fn credentials(&self, profile: &SshProfile) -> Option<SshCredentials> {
        self.credentials
            .get(&profile.id)
            .filter(|cached| {
                Some(cached.revision) == profile.revision
                    && cached.secret.matches_auth(&profile.auth)
            })
            .map(|cached| cached.secret.clone())
    }

    pub(super) fn save(&mut self, profile: &SshProfile, secret: SshCredentials) {
        // A concurrent profile refresh may have already invalidated this response.
        if self
            .profiles
            .as_ref()
            .is_some_and(|profiles| profiles.iter().any(|item| same_profile(item, profile)))
        {
            if let Some(revision) = profile.revision {
                self.credentials
                    .insert(profile.id.clone(), CachedCredentials { revision, secret });
            }
        }
    }

    pub(super) fn forget_credentials(&mut self, id: &str) {
        self.credentials.remove(id);
    }

    pub(super) fn observe(&mut self, profiles: &[SshProfile], generation: u64) {
        // Responses may complete in a different order from profile edits or other refreshes.
        if generation < self.generation {
            return;
        }
        self.generation = generation;
        self.credentials.retain(|id, secret| {
            profiles.iter().any(|profile| {
                profile.id == *id
                    && profile.revision == Some(secret.revision)
                    && self
                        .profiles
                        .as_ref()
                        .is_some_and(|old| old.iter().any(|item| same_profile(item, profile)))
            })
        });
        self.profiles = Some(profiles.to_vec());
    }

    fn valid(&self) -> bool {
        self.profiles
            .as_ref()
            .is_none_or(|profiles| profiles.len() <= 64 && profiles.iter().all(valid_profile))
            && self.credentials.len() <= 64
            && self
                .credentials
                .values()
                .all(|cached| cached.secret.valid())
    }
}

fn same_profile(left: &SshProfile, right: &SshProfile) -> bool {
    // Include host trust and every endpoint field, even if a server mistakenly keeps the revision.
    serde_json::to_value(left).ok() == serde_json::to_value(right).ok()
}

fn scope(identity: &GuiCloudIdentity) -> String {
    let mut digest = Sha256::new();
    digest.update(identity.base_url.as_bytes());
    digest.update([0]);
    digest.update(identity.user_id.as_bytes());
    format!("{:x}", digest.finalize())
}

pub(super) fn read<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    identity: &GuiCloudIdentity,
    credentials: &CloudCredentials,
    action: impl FnOnce(&mut AccountCache) -> T,
) -> Option<T> {
    let session = credentials.session.as_ref()?;
    let mut guard = session.epoch.ssh_cache.data.lock().ok()?;
    let scope = scope(identity);
    if guard.as_ref().is_none_or(|(saved, _)| saved != &scope) {
        let data = disk::load(app, &scope).unwrap_or_else(|_| {
            eprintln!("SSH cache could not be read; fetching a new snapshot");
            AccountCache::default()
        });
        *guard = Some((scope, data));
    }
    guard.as_mut().map(|(_, cache)| action(cache))
}

pub(super) fn update<R: Runtime>(
    app: &tauri::AppHandle<R>,
    identity: &GuiCloudIdentity,
    credentials: &CloudCredentials,
    action: impl FnOnce(&mut AccountCache),
) {
    let result = with_cloud_session(app, credentials, || {
        read(app, identity, credentials, |cache| {
            action(cache);
            if disk::save(app, &scope(identity), cache).is_err() {
                // A locked OS vault or unavailable disk must not block an otherwise usable SSH login.
                eprintln!("SSH cache persistence unavailable; retaining the in-memory snapshot");
            }
        })
        .ok_or_else(|| ProfileError::Unavailable.to_string())
    });
    if result.is_err() {
        eprintln!("SSH cache update skipped because its session is unavailable");
    }
}

#[cfg(test)]
mod tests;
