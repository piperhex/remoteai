use super::*;

fn fixture() -> (tempfile::TempDir, state::Record) {
    let root = tempfile::tempdir().unwrap();
    let record = state::Record {
        home: root.path().join("home"),
        enabled: true,
        administrator: true,
        generation: "generation".into(),
        version: super::super::VERSION.into(),
    };
    state::save(root.path(), &record).unwrap();
    (root, record)
}

#[test]
fn legacy_installations_do_not_opt_into_administrator_access() {
    let record: state::Record = serde_json::from_value(serde_json::json!({
        "home": "home", "enabled": true, "generation": "old"
    }))
    .unwrap();
    assert!(!record.administrator);
}

#[test]
fn revocation_and_generation_changes_invalidate_only_the_matching_grant() {
    let (root, mut record) = fixture();
    let id = state::home_id(&record.home);
    let grant = lease::Lease {
        id: uuid::Uuid::new_v4(),
        generation: record.generation.clone(),
        owner: 1,
        owner_started: 1,
        broker: 2,
        broker_started: 2,
    };
    lease::save(root.path(), &id, &grant).unwrap();
    assert!(lease::matches(root.path(), &id, &grant));
    assert!(!lease::matches(
        root.path(),
        &state::home_id(&root.path().join("other")),
        &grant
    ));
    record.generation = "reinstalled".into();
    state::save(root.path(), &record).unwrap();
    assert!(!lease::matches(root.path(), &id, &grant));
    record.generation = grant.generation.clone();
    record.administrator = false;
    state::save(root.path(), &record).unwrap();
    assert!(!lease::matches(root.path(), &id, &grant));
    record.administrator = true;
    record.enabled = false;
    state::save(root.path(), &record).unwrap();
    assert!(!lease::matches(root.path(), &id, &grant));
}

#[test]
fn stale_process_ids_and_replaced_leases_do_not_reactivate_access() {
    let (root, record) = fixture();
    let id = state::home_id(&record.home);
    let grant = lease::Lease {
        id: uuid::Uuid::new_v4(),
        generation: record.generation,
        owner: std::process::id(),
        owner_started: 0,
        broker: std::process::id(),
        broker_started: 0,
    };
    lease::save(root.path(), &id, &grant).unwrap();
    assert!(lease::active(root.path(), &id).is_none());
    let mut replaced = grant.clone();
    replaced.id = uuid::Uuid::new_v4();
    lease::save(root.path(), &id, &replaced).unwrap();
    assert!(!lease::matches(root.path(), &id, &grant));
    assert!(lease::read(root.path(), "../../outside").is_err());
    lease::remove(root.path(), &id).unwrap();
    assert!(lease::read(root.path(), &id).unwrap().is_none());
}

#[test]
fn gui_entry_requires_opt_in_and_does_not_repeat_a_declined_prompt() {
    let (root, mut record) = fixture();
    let attempts = Mutex::new(HashSet::new());
    let prompts = std::cell::Cell::new(0);
    let authorize = || {
        prompts.set(prompts.get() + 1);
        Err(ComputerError::Administrator)
    };
    record.administrator = false;
    state::save(root.path(), &record).unwrap();
    prepare_with(root.path(), &record.home, &attempts, authorize).unwrap();
    assert_eq!(prompts.get(), 0);
    request_on_entry(root.path(), &record.home).unwrap();
    assert_eq!(
        prompts.get(),
        0,
        "checking the preference must not show UAC"
    );
    assert!(prepare_with(root.path(), &record.home, &attempts, authorize).is_err());
    prepare_with(root.path(), &record.home, &attempts, authorize).unwrap();
    assert_eq!(prompts.get(), 1);
    let next_launch = Mutex::new(HashSet::new());
    assert!(prepare_with(root.path(), &record.home, &next_launch, authorize).is_err());
    assert_eq!(prompts.get(), 2);
}

#[test]
fn the_current_process_identity_is_valid_and_unknown_processes_are_refused() {
    let current = native::Process::open(std::process::id()).unwrap();
    current.trusted().unwrap();
    assert!(current.alive());
    assert_ne!(current.started().unwrap(), 0);
    assert!(native::Process::open(u32::MAX).is_err());
}

#[test]
fn modified_or_missing_binaries_cannot_start_elevated() {
    let (root, _) = fixture();
    assert!(verified_package::lock(root.path()).is_err());
    let directory = super::super::package::directory(root.path()).unwrap();
    std::fs::create_dir_all(&directory).unwrap();
    for name in super::super::platform::asset().unwrap().files {
        std::fs::write(directory.join(name), "modified").unwrap();
    }
    assert!(verified_package::lock(root.path()).is_err());
}

#[tokio::test]
async fn named_pipe_handshake_authenticates_the_expected_process() {
    let id = uuid::Uuid::new_v4();
    let server = pipe::server(id, true).unwrap();
    assert!(pipe::server(id, true).is_err());
    let (connected, client) = tokio::join!(server.connect(), pipe::connect(id, std::process::id()));
    connected.unwrap();
    let mut client = client.unwrap();
    assert_eq!(pipe::client(&server).unwrap(), std::process::id());
    let mut server = server;
    pipe::write(&mut client, &serde_json::json!({"value": 42}))
        .await
        .unwrap();
    let value: serde_json::Value = pipe::read(&mut server).await.unwrap();
    assert_eq!(value["value"], 42);
}

#[tokio::test]
async fn a_spoofed_server_process_is_rejected() {
    let id = uuid::Uuid::new_v4();
    let server = pipe::server(id, true).unwrap();
    let (connected, result) = tokio::join!(server.connect(), pipe::connect(id, u32::MAX));
    connected.unwrap();
    assert!(result.is_err());
}
