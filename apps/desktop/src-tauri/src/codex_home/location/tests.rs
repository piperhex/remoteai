use super::*;
use rusqlite::Connection;

fn change(path: &Path, mode: HomeMode) -> HomeChange {
    HomeChange {
        path: path.to_owned(),
        mode,
    }
}

#[test]
fn copy_preserves_source_and_rebases_history_then_restores_without_copying() {
    let root = tempfile::tempdir().unwrap();
    let mut state = read(root.path()).unwrap();
    let old = state.current.clone();
    let rollout = old.join("sessions").join("rollout.jsonl");
    fs::create_dir_all(rollout.parent().unwrap()).unwrap();
    fs::write(&rollout, "original").unwrap();
    let database = "state_5.sqlite";
    let db = Connection::open(old.join(database)).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE threads (id TEXT, rollout_path TEXT)")
        .unwrap();
    db.execute(
        "INSERT INTO threads VALUES ('thread', ?1)",
        [rollout.to_str().unwrap()],
    )
    .unwrap();
    // Keep committed frames in the WAL while copying.
    assert!(old.join("state_5.sqlite-wal").exists());
    let next = root.path().join("next");
    fs::create_dir(&next).unwrap();
    state.transaction = Some(uuid::Uuid::new_v4());
    let request = change(&next, HomeMode::Copy);
    state.pending = Some(request.clone());
    save(root.path(), &state).unwrap();
    apply(&mut state, &request, &[]).unwrap();
    let mut interrupted = read(root.path()).unwrap();
    apply(&mut interrupted, &request, &[]).unwrap();
    assert_eq!(interrupted.current, next);
    for home in [&old, &next] {
        let stored: String = Connection::open(home.join(database))
            .unwrap()
            .query_row("SELECT rollout_path FROM threads", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&stored),
            home.join("sessions").join("rollout.jsonl")
        );
        assert_eq!(fs::read_to_string(stored).unwrap(), "original");
    }
    assert_eq!(state.history.len(), 1);
    assert!(!state.history[0].enabled);
    fs::write(&rollout, "original only").unwrap();
    state.transaction = None;
    apply(&mut state, &change(&old, HomeMode::Restore), &[]).unwrap();
    assert_eq!(state.current, old);
    assert_eq!(state.history.len(), 1);
    assert_eq!(Path::new(&state.history[0].path), next);
    assert_eq!(fs::read_to_string(&rollout).unwrap(), "original only");
}

#[test]
fn fresh_keeps_the_old_data_and_rejects_occupied_nested_and_external_targets() {
    let root = tempfile::tempdir().unwrap();
    let mut state = read(root.path()).unwrap();
    let old = state.current.clone();
    fs::create_dir_all(old.join("nested")).unwrap();
    fs::write(old.join("settings"), "keep").unwrap();
    let next = root.path().join("fresh");
    fs::create_dir(&next).unwrap();
    let fresh = change(&next, HomeMode::Fresh);
    let external = CodexHomeEntry {
        id: "external".into(),
        path: next.to_string_lossy().into_owned(),
        enabled: false,
    };
    assert!(validate(&state, &fresh, &[external]).is_err());
    assert!(validate(&state, &change(&old.join("nested"), HomeMode::Copy), &[]).is_err());
    assert!(validate(&state, &change(root.path(), HomeMode::Copy), &[]).is_err());
    assert!(validate(&state, &change(&next, HomeMode::Restore), &[]).is_err());
    fs::write(next.join("mine"), "keep").unwrap();
    assert!(apply(&mut state, &fresh, &[]).is_err());
    assert_eq!(state.current, old);
    fs::remove_file(next.join("mine")).unwrap();
    apply(&mut state, &fresh, &[]).unwrap();
    assert!(fs::read_dir(next).unwrap().next().is_none());
    assert_eq!(fs::read_to_string(old.join("settings")).unwrap(), "keep");
}

#[test]
fn scheduled_change_is_visible_only_after_startup_and_previous_home_is_a_sync_source() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier =
        format!("dev.codex.switch.home-change-test.{}", uuid::Uuid::new_v4());
    let app = tauri::test::mock_builder().build(context).unwrap();
    let handle = app.handle();
    let root = root(handle).unwrap();
    let previous = root.join(".codex");
    let target = root.join("custom");
    fs::create_dir_all(&previous).unwrap();
    fs::create_dir(&target).unwrap();
    let request = || {
        tauri::async_runtime::block_on(change_agent_hub_home(
            handle.clone(),
            Some(change(&target, HomeMode::Fresh)),
        ))
        .unwrap()
    };
    assert!(request().pending.is_some());
    assert_eq!(super::super::gui_home(handle).unwrap(), previous);
    let cancelled =
        tauri::async_runtime::block_on(change_agent_hub_home(handle.clone(), None)).unwrap();
    assert!(cancelled.pending.is_none());
    request();
    initialize(handle).unwrap();
    crate::storage::migrate_app_settings_for_version(handle).unwrap();
    assert!(super::super::paths_match(
        &super::super::gui_home(handle).unwrap(),
        &target
    ));
    let configured = crate::storage::read_app_settings(handle)
        .unwrap()
        .codex_homes;
    assert!(!configured
        .iter()
        .any(|h| super::super::paths_match(Path::new(&h.path), &previous)));
    let archived = history(handle).pop().unwrap();
    assert_eq!(
        super::super::resolve_sync_source(handle, &archived.id).unwrap(),
        previous
    );
    assert!(super::super::resolve_selected(handle, Some(&archived.id)).is_err());
    let current = configured
        .iter()
        .find(|h| h.id == super::super::GUI_CODEX_HOME_ID)
        .unwrap();
    assert!(super::super::paths_match(Path::new(&current.path), &target));
    assert!(!current.enabled);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn broken_database_does_not_publish_partial_data() {
    let root = tempfile::tempdir().unwrap();
    let mut state = read(root.path()).unwrap();
    fs::create_dir(&state.current).unwrap();
    let broken = state.current.join("state_5.sqlite");
    fs::write(&broken, b"SQLite format 3\0truncated").unwrap();
    let next = root.path().join("new");
    fs::create_dir(&next).unwrap();
    state.transaction = Some(uuid::Uuid::new_v4());
    assert!(apply(&mut state, &change(&next, HomeMode::Copy), &[]).is_err());
    assert_eq!(state.current, root.path().join(".codex"));
    assert!(state.history.is_empty());
    assert!(fs::read_dir(next).unwrap().next().is_none());
    assert!(broken.is_file());
}
