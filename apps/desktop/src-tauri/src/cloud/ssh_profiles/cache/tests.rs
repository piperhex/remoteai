use super::*;
use crate::cloud::{
    credential_tests::{respond, Fixture},
    ssh_profiles::agent::{self, Target},
};
use std::thread;

fn profile() -> SshProfile {
    serde_json::from_value(
        json!({"id":"one", "name":"fixture", "host":"localhost", "port":22,
        "username":"fixture", "auth":"password", "revision":1, "fingerprint":"SHA256:fixture"}),
    )
    .unwrap()
}

pub(super) fn fixture() -> AccountCache {
    let profile = profile();
    let mut cache = AccountCache::default();
    cache.observe(std::slice::from_ref(&profile), 0);
    cache.save(
        &profile,
        serde_json::from_value(json!({"password":"saved-password"})).unwrap(),
    );
    cache
}

fn target() -> Target {
    Target {
        id: "one".into(),
        revision: 1,
    }
}

#[test]
fn changed_endpoint_revision_or_deleted_profile_evicts_credentials() {
    for change in ["revision", "host", "fingerprint"] {
        let mut cache = fixture();
        let mut changed = serde_json::to_value(profile()).unwrap();
        changed[change] = if change == "revision" {
            json!(2)
        } else {
            json!("changed")
        };
        let changed: SshProfile = serde_json::from_value(changed).unwrap();
        cache.observe(&[changed], 1);
        assert!(cache.credentials(&profile()).is_none());
    }
    let mut cache = fixture();
    cache.observe(&[], 1);
    assert!(cache.credentials(&profile()).is_none());
    cache.save(
        &profile(),
        serde_json::from_value(json!({"password":"late-response"})).unwrap(),
    );
    assert!(cache.credentials(&profile()).is_none());
}

#[test]
fn late_snapshots_cannot_restore_deleted_profiles_or_credentials() {
    let mut cache = fixture();
    cache.observe(&[], 2);
    cache.observe(&[profile()], 1);
    assert!(cache.profiles().unwrap().is_empty());
    assert!(cache.credentials(&profile()).is_none());
}

#[test]
fn background_refreshes_share_one_flight_per_profile_and_release_after_failure() {
    let fixture = Fixture::new();
    let credentials = fixture.credentials();
    let lease = start_refresh(&credentials, "profile:one").unwrap();
    assert!(start_refresh(&credentials, "profile:one").is_none());
    assert!(start_refresh(&credentials, "profile:two").is_some());
    drop(lease);
    assert!(start_refresh(&credentials, "profile:one").is_some());
}

#[test]
fn credential_fetch_retries_and_updates_the_next_cached_login() {
    let fixture = Fixture::new();
    let app = fixture.app.handle().clone();
    let worker = thread::spawn(move || agent::session(&app).unwrap().refresh(&app, &target()));
    for _ in 0..3 {
        respond(fixture.recv("/sync/ssh-profiles"), 200, json!([profile()]));
        respond(
            fixture.recv("/sync/ssh-profiles/one/credentials"),
            503,
            json!({}),
        );
    }
    respond(fixture.recv("/sync/ssh-profiles"), 200, json!([profile()]));
    respond(
        fixture.recv("/sync/ssh-profiles/one/credentials"),
        200,
        json!({"credentials":{"password":"refreshed-password"}}),
    );
    assert!(worker.join().unwrap().is_ok());
    let (request, cached) = agent::session(fixture.app.handle())
        .unwrap()
        .prepare(fixture.app.handle(), &target())
        .unwrap();
    assert!(cached);
    assert_eq!(request.password.as_deref(), Some("refreshed-password"));
}

#[test]
fn encrypted_disk_cache_survives_new_session_and_isolates_accounts() {
    let fixture = Fixture::new();
    let identity = GuiCloudIdentity {
        base_url: fixture.url(),
        user_id: "first".into(),
    };
    let scope = scope(&identity);
    disk::save(fixture.app.handle(), &scope, &self::fixture()).unwrap();
    let session = agent::session(fixture.app.handle()).unwrap();
    let (request, cached) = session.prepare(fixture.app.handle(), &target()).unwrap();
    assert!(cached);
    assert_eq!(request.password.as_deref(), Some("saved-password"));
    assert!(fixture
        .server
        .recv_timeout(Duration::from_millis(50))
        .unwrap()
        .is_none());
    fixture.login("second");
    assert!(matches!(
        session.prepare(fixture.app.handle(), &target()),
        Err(ProfileError::Authentication)
    ));
    let second = GuiCloudIdentity {
        base_url: fixture.url(),
        user_id: "second".into(),
    };
    assert!(disk::load(fixture.app.handle(), &super::scope(&second))
        .unwrap()
        .profiles()
        .is_none());
    fixture.login("first");
    let (_, cached) = agent::session(fixture.app.handle())
        .unwrap()
        .prepare(fixture.app.handle(), &target())
        .unwrap();
    assert!(cached);
}

#[test]
fn sync_retries_three_times_then_caches_both_profiles_and_credentials() {
    let fixture = Fixture::new();
    let app = fixture.app.handle().clone();
    let worker = thread::spawn(move || agent::session(&app).unwrap().prepare(&app, &target()));
    for _ in 0..3 {
        respond(fixture.recv("/sync/ssh-profiles"), 503, json!({}));
    }
    respond(fixture.recv("/sync/ssh-profiles"), 200, json!([profile()]));
    respond(
        fixture.recv("/sync/ssh-profiles/one/credentials"),
        200,
        json!({"credentials":{"password":"saved-password"}}),
    );
    let (request, cached) = worker.join().unwrap().unwrap();
    assert!(!cached);
    assert_eq!(request.password.as_deref(), Some("saved-password"));
    let (request, cached) = agent::session(fixture.app.handle())
        .unwrap()
        .prepare(fixture.app.handle(), &target())
        .unwrap();
    assert!(cached);
    assert_eq!(request.password.as_deref(), Some("saved-password"));
    assert!(fixture
        .server
        .recv_timeout(Duration::from_millis(50))
        .unwrap()
        .is_none());
}

#[test]
fn background_sync_keeps_cached_list_available_while_server_is_slow() {
    let fixture = Fixture::new();
    let app = fixture.app.handle();
    let identity = GuiCloudIdentity {
        base_url: fixture.url(),
        user_id: "first".into(),
    };
    let credentials = fixture.credentials();
    update(app, &identity, &credentials, |cache| {
        *cache = self::fixture()
    });
    let profiles = agent::agent_ssh_profiles(app).unwrap();
    assert_eq!(profiles.len(), 1);
    let pending = fixture.recv("/sync/ssh-profiles");
    // A pending refresh neither blocks cache reads nor holds the cloud credential lock.
    assert!(
        agent::session(app)
            .unwrap()
            .prepare(app, &target())
            .unwrap()
            .1
    );
    respond(pending, 200, json!([]));
    for _ in 0..100 {
        if read(app, &identity, &credentials, |cache| {
            cache.profiles().unwrap().is_empty()
        }) == Some(true)
        {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("background refresh did not update the cache");
}
