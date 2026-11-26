use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params, Connection};
use serde_json::json;
use std::collections::HashSet;

fn auth(user: &str, account: &str) -> Value {
    let claims = json!({"https://api.openai.com/auth": {
        "chatgpt_user_id": user, "chatgpt_account_id": account
    }});
    json!({"tokens": {
        "id_token": format!("e30.{}.unusable", URL_SAFE_NO_PAD.encode(claims.to_string())),
        "account_id": account
    }})
}

fn section(id: &str, host: &str, items: Value) -> Value {
    json!({"id": id, "name": "Work", "hostSectionIds": {"local": host}, "itemKeys": items})
}

fn layout(sections: Value) -> Value {
    json!({"sections": sections, "sectionOrder": ["threads"], "collapsedSectionIds": []})
}

fn projects() -> HashSet<String> {
    ["p1", "p2", "p3"].into_iter().map(str::to_string).collect()
}

#[test]
fn preserves_existing_target_assignment_and_matches_stable_host_ids() {
    let source = layout(json!([
        section(
            "source-a",
            "host-a",
            json!(["codex:project:p1", "codex:project:p2"])
        ),
        section("source-b", "host-b", json!(["codex:project:p3"]))
    ]));
    let mut target = layout(json!([
        section("target-a", "host-a", json!([])),
        section("target-b", "host-b", json!(["codex:project:p1"]))
    ]));
    target["unknown"] = json!({"keep": true});
    target["collapsedSectionIds"] = json!(["target-b"]);
    assert_eq!(
        membership::merge(&source, &mut target, &projects()).unwrap(),
        2
    );
    assert_eq!(target["sections"][0]["id"], "target-a");
    assert_eq!(
        target["sections"][0]["itemKeys"],
        json!(["codex:project:p2"])
    );
    assert_eq!(
        target["sections"][1]["itemKeys"],
        json!(["codex:project:p1", "codex:project:p3"])
    );
    assert_eq!(target["collapsedSectionIds"], json!(["target-b"]));
    assert_eq!(target["unknown"], json!({"keep": true}));
    let once = target.clone();
    assert_eq!(
        membership::merge(&source, &mut target, &projects()).unwrap(),
        0
    );
    assert_eq!(target, once);
}

#[test]
fn copies_only_registered_local_projects_and_local_host_links() {
    let mut source = layout(json!([
        section("source", "host-a", json!([
            "codex:project:p1", "codex:project:unregistered", "chatgpt:project:cloud",
            "codex:thread:local:private", "codex:project:p1"
        ])),
        {"id": "remote-only", "name": "Remote", "hostSectionIds": {"remote": "remote-section"},
         "itemKeys": ["codex:project:p2"]}
    ]));
    source["sections"][0]["hostSectionIds"]["remote"] = json!("remote-section");
    source["threadHostIds"] = json!({"private": "remote"});
    let mut target = membership::empty_layout();
    assert_eq!(
        membership::merge(&source, &mut target, &projects()).unwrap(),
        1
    );
    assert_eq!(target["sections"].as_array().unwrap().len(), 1);
    assert_eq!(
        target["sections"][0]["itemKeys"],
        json!(["codex:project:p1"])
    );
    assert_eq!(
        target["sections"][0]["hostSectionIds"],
        json!({"local": "host-a"})
    );
    assert_ne!(target["sections"][0]["id"], "source");
    assert!(target.get("threadHostIds").is_none());
}

#[test]
fn respects_pending_item_removals_and_deleted_sections() {
    let mut source = layout(json!([
        section("s1", "h1", json!(["codex:project:p1", "codex:project:p2"])),
        section("s2", "h2", json!(["codex:project:p3"]))
    ]));
    source["sections"][0]["pendingDeletionHostIdsByItemKey"] =
        json!({"codex:project:p1": ["local"]});
    let mut target = layout(json!([section("t1", "h1", json!([]))]));
    target["sections"][0]["pendingDeletionHostIdsByItemKey"] =
        json!({"codex:project:p2": ["local"]});
    target["appServerDeletedSectionIds"] = json!(["h2"]);
    let before = target.clone();
    assert_eq!(
        membership::merge(&source, &mut target, &projects()).unwrap(),
        0
    );
    assert_eq!(target, before);
}

#[test]
fn malformed_layout_is_rejected_without_replacing_target() {
    let source = layout(json!([section(
        "source",
        "host",
        json!(["codex:project:p1"])
    )]));
    let mut target =
        json!({"sections": "new-format", "sectionOrder": [], "collapsedSectionIds": []});
    let before = target.clone();
    assert!(membership::merge(&source, &mut target, &projects()).is_err());
    assert_eq!(target, before);
}

#[test]
fn computes_desktop_owner_from_user_and_workspace_without_guessing() {
    use sha2::{Digest, Sha256};
    let credential = auth("synthetic-user", "synthetic-account");
    let identity = identity::Identity::from_auth(&credential).unwrap();
    let expected = hex::encode(Sha256::digest(br#"["synthetic-user","synthetic-account"]"#));
    assert_eq!(identity.scope, format!("{OWNER_PREFIX}{expected}"));
    assert_ne!(
        identity,
        identity::Identity::from_auth(&auth("another-user", "synthetic-account")).unwrap()
    );
    assert!(identity::Identity::from_auth(&json!({"OPENAI_API_KEY": "fake"})).is_none());
    assert!(identity::Identity::from_auth(&json!({"tokens": {"id_token": "opaque"}})).is_none());
}

struct Fixture {
    home: tempfile::TempDir,
    connection: Connection,
    source_auth: Value,
    target_auth: Value,
    source: identity::Identity,
    target: identity::Identity,
}

impl Fixture {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let connection = Connection::open(home.path().join(".codex-global-state.sqlite")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE settings (
            scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key)
        ) WITHOUT ROWID;",
            )
            .unwrap();
        let source_auth = auth("synthetic-user-a", "synthetic-account-a");
        let target_auth = auth("synthetic-user-b", "synthetic-account-b");
        let source = identity::Identity::from_auth(&source_auth).unwrap();
        let target = identity::Identity::from_auth(&target_auth).unwrap();
        let fixture = Self {
            home,
            connection,
            source_auth,
            target_auth,
            source,
            target,
        };
        fixture.put(
            "global",
            "electron-renderer-content-owner",
            json!(fixture.source.scope.strip_prefix(OWNER_PREFIX).unwrap()),
        );
        fixture.put(
            "global",
            "local-projects",
            json!({"p1": {"rootPaths": ["/synthetic/project"]}}),
        );
        fixture.put(
            &fixture.source.scope,
            SECTION_KEY,
            json!({fixture.source.account.clone(): layout(json!([
                section("source-section", "shared-host-section", json!(["codex:project:p1"]))
            ]))}),
        );
        fixture
    }

    fn put(&self, scope: &str, key: &str, value: Value) {
        self.connection
            .execute(
                "INSERT OR REPLACE INTO settings VALUES (?1,?2,?3)",
                params![scope, key, value.to_string()],
            )
            .unwrap();
    }

    fn target(&self) -> Value {
        let raw: String = self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE scope=?1 AND key=?2",
                params![self.target.scope, SECTION_KEY],
                |row| row.get(0),
            )
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    fn run(&self) -> Result<usize, SyncError> {
        sync(self.home.path(), &self.source_auth, &self.target_auth)
    }
}

#[test]
fn sqlite_sync_initializes_new_owner_and_keeps_source_json_and_other_rows() {
    let fixture = Fixture::new();
    let snapshot = fixture.home.path().join(".codex-global-state.json");
    std::fs::write(&snapshot, b"stale migration snapshot").unwrap();
    fixture.put(
        &fixture.target.scope,
        "unrelated-preference",
        json!({"private": "preserve"}),
    );
    assert_eq!(fixture.run().unwrap(), 1);
    assert_eq!(
        fixture.target()[&fixture.target.account]["sections"][0]["itemKeys"],
        json!(["codex:project:p1"])
    );
    assert_eq!(fixture.run().unwrap(), 0);
    assert_eq!(
        std::fs::read(&snapshot).unwrap(),
        b"stale migration snapshot"
    );
    let unrelated: String = fixture
        .connection
        .query_row(
            "SELECT value FROM settings WHERE scope=?1 AND key='unrelated-preference'",
            params![fixture.target.scope],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&unrelated).unwrap(),
        json!({"private": "preserve"})
    );
    assert_eq!(
        std::fs::read_dir(fixture.home.path().join("sidebar-sync-backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn backup_preserves_exact_previous_row_for_recovery() {
    let fixture = Fixture::new();
    let original = json!({fixture.target.account.clone(): membership::empty_layout(), "other-account": {"keep": true}});
    fixture.put(&fixture.target.scope, SECTION_KEY, original.clone());
    assert_eq!(fixture.run().unwrap(), 1);
    let backup = std::fs::read_dir(fixture.home.path().join("sidebar-sync-backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let backup: Value = serde_json::from_slice(&std::fs::read(backup).unwrap()).unwrap();
    assert_eq!(backup["scope"], fixture.target.scope);
    assert_eq!(
        serde_json::from_str::<Value>(backup["previousValue"].as_str().unwrap()).unwrap(),
        original
    );
    assert_eq!(fixture.target()["other-account"], json!({"keep": true}));
}

#[test]
fn failed_database_write_rolls_back_and_backup_is_available() {
    let fixture = Fixture::new();
    fixture
        .connection
        .execute_batch(
            "CREATE TRIGGER reject_sync BEFORE INSERT ON settings
        WHEN NEW.key = 'sidebar-custom-sections-v3'
        BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;",
        )
        .unwrap();
    assert!(fixture.run().is_err());
    let count: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE scope=?1",
            params![fixture.target.scope],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(
        std::fs::read_dir(fixture.home.path().join("sidebar-sync-backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn backup_failure_leaves_database_untouched() {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.home.path().join("sidebar-sync-backups"),
        b"not a directory",
    )
    .unwrap();
    assert!(fixture.run().is_err());
    let count: i64 = fixture
        .connection
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE scope=?1",
            params![fixture.target.scope],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn wrong_active_owner_missing_database_and_same_identity_are_noops() {
    let fixture = Fixture::new();
    fixture.put(
        "global",
        "electron-renderer-content-owner",
        json!("not-the-source"),
    );
    assert_eq!(fixture.run().unwrap(), 0);
    assert!(!fixture.home.path().join("sidebar-sync-backups").exists());
    let empty = tempfile::tempdir().unwrap();
    assert_eq!(
        sync(empty.path(), &fixture.source_auth, &fixture.target_auth).unwrap(),
        0
    );
    assert_eq!(std::fs::read_dir(empty.path()).unwrap().count(), 0);
    assert_eq!(
        sync(
            fixture.home.path(),
            &fixture.source_auth,
            &fixture.source_auth
        )
        .unwrap(),
        0
    );
}

#[test]
fn round_trip_adds_new_memberships_without_duplicates_or_overwriting_accounts() {
    let fixture = Fixture::new();
    assert_eq!(fixture.run().unwrap(), 1);
    let mut target = fixture.target();
    target[&fixture.target.account]["sections"][0]["itemKeys"] =
        json!(["codex:project:p1", "codex:project:p2"]);
    fixture.put(&fixture.target.scope, SECTION_KEY, target);
    fixture.put("global", "local-projects", json!({"p1": {}, "p2": {}}));
    fixture.put(
        "global",
        "electron-renderer-content-owner",
        json!(fixture.target.scope.strip_prefix(OWNER_PREFIX).unwrap()),
    );
    assert_eq!(
        sync(
            fixture.home.path(),
            &fixture.target_auth,
            &fixture.source_auth
        )
        .unwrap(),
        1
    );
    let raw: String = fixture
        .connection
        .query_row(
            "SELECT value FROM settings WHERE scope=?1 AND key=?2",
            params![fixture.source.scope, SECTION_KEY],
            |row| row.get(0),
        )
        .unwrap();
    let source: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        source[&fixture.source.account]["sections"][0]["id"],
        "source-section"
    );
    assert_eq!(
        source[&fixture.source.account]["sections"][0]["itemKeys"],
        json!(["codex:project:p1", "codex:project:p2"])
    );
    fixture.put(
        "global",
        "electron-renderer-content-owner",
        json!(fixture.source.scope.strip_prefix(OWNER_PREFIX).unwrap()),
    );
    assert_eq!(fixture.run().unwrap(), 0);
}

#[test]
fn empty_source_and_corrupt_target_do_not_write_or_create_backups() {
    let fixture = Fixture::new();
    fixture.put(
        &fixture.target.scope,
        SECTION_KEY,
        json!({fixture.target.account.clone(): {"sections": "bad"}}),
    );
    let before = fixture.target();
    assert!(fixture.run().is_err());
    assert_eq!(fixture.target(), before);
    fixture.put(
        &fixture.source.scope,
        SECTION_KEY,
        json!({fixture.source.account.clone(): membership::empty_layout()}),
    );
    fixture.put(
        &fixture.target.scope,
        SECTION_KEY,
        json!({fixture.target.account.clone(): membership::empty_layout()}),
    );
    assert_eq!(fixture.run().unwrap(), 0);
    assert!(!fixture.home.path().join("sidebar-sync-backups").exists());
}

#[test]
fn target_pinned_projects_are_not_imported_into_custom_sections() {
    let fixture = Fixture::new();
    fixture.put(
        &fixture.target.scope,
        "unified-sidebar-pinned-order-v1",
        json!(["codex:project:p1", "codex:thread:local:synthetic-thread"]),
    );
    assert_eq!(fixture.run().unwrap(), 0);
    assert!(!fixture.home.path().join("sidebar-sync-backups").exists());
}
