use super::*;
use rusqlite::Connection;

fn fixture() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let connection = Connection::open(home.path().join("state_5.sqlite")).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, history_mode TEXT, name TEXT,
        title TEXT, preview TEXT, cwd TEXT, updated_at INTEGER, archived INTEGER, source TEXT);
        WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<10000)
        INSERT INTO threads SELECT 'thread-'||n, 'paginated', 'Conversation '||n, 'Question',
        'Question', '/project', n, n=2, 'cli' FROM sequence;
        UPDATE threads SET source='exec' WHERE id='thread-3';
        UPDATE threads SET preview='', title='' WHERE id='thread-4';",
        )
        .unwrap();
    home
}

#[test]
fn reads_only_explicit_members_including_old_chats_without_loading_history() {
    let home = fixture();
    let mut query = Query {
        thread_ids: [
            "thread-1", "thread-2", "thread-3", "thread-4", "thread-1", "missing",
        ]
        .map(str::to_owned)
        .to_vec(),
        archived: false,
    };
    let recent = read(home.path(), Path::new("/scratch"), &query).unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].id, "thread-1");
    assert_eq!(recent[0].name, "Conversation 1");
    assert_eq!(recent[0].cwd, "/project");
    assert_eq!(recent[0].updated_at, 1);
    query.archived = true;
    let archived = read(home.path(), Path::new("/scratch"), &query).unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].id, "thread-2");
    assert!(!home.path().join("sessions").exists());
}

#[test]
fn validates_ids_and_binds_them_as_data() {
    for id in [String::new(), "x".repeat(201), "bad\0id".to_owned()] {
        assert!(Query {
            thread_ids: vec![id],
            archived: false
        }
        .validate()
        .is_err());
    }
    let home = fixture();
    let query = Query {
        thread_ids: vec!["' OR 1=1 --".into()],
        archived: false,
    };
    assert!(read(home.path(), Path::new("/scratch"), &query)
        .unwrap()
        .is_empty());
}
