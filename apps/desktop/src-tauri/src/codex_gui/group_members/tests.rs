use super::*;
use rusqlite::{params, Connection};

fn fixture() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let connection = Connection::open(home.path().join("state_5.sqlite")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, history_mode TEXT,
        name TEXT, title TEXT, preview TEXT, first_user_message TEXT, cwd TEXT,
        updated_at INTEGER, archived INTEGER, source TEXT)",
        )
        .unwrap();
    for index in 0..235 {
        connection
            .execute(
                "INSERT INTO threads VALUES (?1, 'paginated', ?2, 'First message',
            'First message', 'First message', ?3, ?4, ?5, 'cli')",
                params![
                    format!("thread-{index:03}"),
                    format!("Conversation {index}"),
                    format!("/projects/{}", index % 3),
                    index,
                    index >= 220
                ],
            )
            .unwrap();
    }
    home
}

fn query() -> Query {
    Query {
        page: 1,
        page_size: 20,
        search: String::new(),
        projects: vec![],
        project_overrides: HashMap::new(),
    }
}

fn read_page(home: &Path, query: &Query) -> Page {
    read(home, Path::new("/scratch"), query).unwrap()
}

#[test]
fn returns_bounded_pages_and_archived_rows_without_reading_rollouts() {
    let home = fixture();
    let mut query = query();
    let first = read_page(home.path(), &query);
    assert_eq!(first.total, 238);
    assert_eq!(first.data.len(), 20);
    assert_eq!(first.data[3].id, "thread-219");
    query.page = 2;
    let second = read_page(home.path(), &query);
    assert_eq!(second.data.len(), 20);
    assert!(second
        .data
        .iter()
        .all(|row| first.data.iter().all(|previous| previous.id != row.id)));
    query.page = 999;
    let last = read_page(home.path(), &query);
    assert_eq!(last.page, 12);
    assert_eq!(last.data.len(), 18);
    assert!(last.data.last().unwrap().archived);
    query.page_size = 100;
    query.page = 1;
    assert_eq!(read_page(home.path(), &query).data.len(), 100);
    assert!(!home.path().join("sessions").exists());
}

#[test]
fn searches_all_pages_with_aliases_overrides_unicode_and_literal_wildcards() {
    let home = fixture();
    let mut query = query();
    query.projects.push(Project {
        path: "/saved".into(),
        name: "ПРОЕКТ_100%".into(),
    });
    query
        .project_overrides
        .insert("thread-234".into(), "/moved".into());
    query.search = "conversation 234".into();
    let page = read_page(home.path(), &query);
    assert_eq!(page.total, 1);
    assert!(page.data[0].archived);
    assert_eq!(page.data[0].cwd, "/moved");
    query.search = "/moved".into();
    assert_eq!(read_page(home.path(), &query).total, 2);
    query.search = "проект_100%".into();
    let page = read_page(home.path(), &query);
    assert_eq!(page.total, 1);
    assert_eq!(page.data[0].id, "/saved");
    query.search = "_' OR 1=1 --".into();
    assert_eq!(read_page(home.path(), &query).total, 0);
}

#[test]
fn keeps_interactive_visibility_projectless_paths_and_name_precedence() {
    let home = fixture();
    let connection = Connection::open(home.path().join("state_5.sqlite")).unwrap();
    connection.execute_batch("UPDATE threads SET source = 'exec' WHERE id = 'thread-000';
        UPDATE threads SET preview = '' WHERE id = 'thread-001';
        UPDATE threads SET cwd = '/scratch/hidden' WHERE id = 'thread-002';
        UPDATE threads SET history_mode = 'legacy', title = 'Manual legacy title' WHERE id = 'thread-003';
        UPDATE threads SET history_mode = 'legacy' WHERE id = 'thread-004';
        UPDATE threads SET name = NULL WHERE id = 'thread-005';").unwrap();
    std::fs::write(
        home.path().join("session_index.jsonl"),
        concat!(
            "{\"id\":\"thread-003\",\"thread_name\":\"Stale legacy name\"}\n",
            "{\"id\":\"thread-004\",\"thread_name\":\"Legacy index name\"}\n",
            "{\"id\":\"thread-005\",\"thread_name\":\"Ignored paginated name\"}\n"
        ),
    )
    .unwrap();
    let mut query = query();
    query.search = "legacy".into();
    let page = read_page(home.path(), &query);
    assert_eq!(page.total, 2);
    assert_eq!(page.data[0].title, "Legacy index name");
    assert_eq!(page.data[1].title, "Manual legacy title");
    query.search = "Ignored paginated".into();
    assert_eq!(read_page(home.path(), &query).total, 0);
    query.search = "scratch".into();
    assert_eq!(read_page(home.path(), &query).total, 0);
    query.search.clear();
    assert_eq!(read_page(home.path(), &query).total, 236);
}

#[test]
fn handles_empty_homes_legacy_schemas_and_read_only_state() {
    let home = tempfile::tempdir().unwrap();
    let mut query = query();
    query.projects.push(Project {
        path: "/saved".into(),
        name: "Saved".into(),
    });
    assert_eq!(read_page(home.path(), &query).total, 1);
    let connection = Connection::open(home.path().join("state_2.sqlite")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, cwd TEXT,
        updated_at INTEGER, archived INTEGER);
        INSERT INTO threads VALUES ('older', 'Legacy', '/older', 1, 0);",
        )
        .unwrap();
    let page = read_page(home.path(), &query);
    assert_eq!(page.total, 3);
    assert_eq!(page.data[2].title, "Legacy");
    let tables: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1);
}

#[test]
fn validates_paging_and_does_not_forward_local_queries_to_app_server() {
    let mut query = query();
    assert!(query.validate().is_ok());
    query.page_size = 1_000;
    assert!(query.validate().is_err());
    query.page_size = 20;
    query.page = 0;
    assert!(query.validate().is_err());
    query.page = 1;
    query.search = "x".repeat(MAX_SEARCH_BYTES + 1);
    assert!(query.validate().is_err());
    query.search.clear();
    assert!(super::super::protocol::GuiRequest::GroupMembersPage(query)
        .into_rpc()
        .is_err());
}
