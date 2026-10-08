//! Upgrade the source constraint without losing history or reusing cleared record IDs.
use rusqlite::Connection;

const SCHEMA_VERSION: i64 = 1;
const CREATE_TABLE: &str = "CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('proxy', 'toast', 'codex')),
    message TEXT NOT NULL,
    status_code INTEGER
);";

pub(super) fn initialize(connection: &mut Connection) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(CREATE_TABLE)?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < SCHEMA_VERSION {
        transaction.execute_batch("ALTER TABLE error_logs RENAME TO error_logs_previous;")?;
        transaction.execute_batch(CREATE_TABLE)?;
        transaction.execute_batch(
            "INSERT INTO error_logs SELECT * FROM error_logs_previous;
             UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
                 (SELECT seq FROM sqlite_sequence WHERE name = 'error_logs_previous'), 0))
                 WHERE name = 'error_logs';
             DROP TABLE error_logs_previous;",
        )?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    transaction.execute_batch(
        "CREATE INDEX IF NOT EXISTS error_logs_source_id ON error_logs(source, id);",
    )?;
    transaction.commit()
}
