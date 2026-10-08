use std::{fs, path::PathBuf};

use super::{database, models::*, sanitize, worker::LogService};

pub(super) struct Fixture(PathBuf);

impl Fixture {
    pub(super) fn new() -> Self {
        Self(std::env::temp_dir().join(format!("codex-switch-error-logs-{}", uuid::Uuid::new_v4())))
    }

    pub(super) fn database_path(&self) -> PathBuf {
        self.0.join("logs.sqlite")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if self.0.exists() {
            fs::remove_dir_all(&self.0).expect("test fixture must be removable");
        }
    }
}

pub(super) fn entry(source: ErrorLogSource, message: &str) -> NewEntry {
    NewEntry {
        created_at: "2026-09-07T01:02:03Z".to_string(),
        source,
        message: message.to_string(),
        status_code: (source == ErrorLogSource::Proxy).then_some(429),
    }
}

fn query(limit: u32, before_id: Option<i64>, source: Option<ErrorLogSource>) -> ListQuery {
    ListQuery::new(Some(limit), before_id, source).unwrap()
}

#[test]
fn codex_diagnostics_persist_original_details_and_redact_sensitive_values() {
    let fixture = Fixture::new();
    let service = LogService::start(fixture.database_path()).unwrap();
    service.record_codex(
        "Codex CLI [extract archive entry]: sharing violation (os error 32); \
        caused by: access denied; path=\"C:\\private\\codex.exe\"; token=private-value",
    );
    let page = service
        .list(query(10, None, Some(ErrorLogSource::Codex)))
        .unwrap();
    assert_eq!(page.entries.len(), 1);
    let message = &page.entries[0].message;
    assert!(message.contains("extract archive entry"));
    assert!(message.contains("os error 32"));
    assert!(message.contains("access denied"));
    assert!(!message.contains("private"));
    service.shutdown_for_test().unwrap();
    let reopened = database::open(&fixture.database_path()).unwrap();
    assert_eq!(
        database::list(&reopened, query(10, None, Some(ErrorLogSource::Codex)))
            .unwrap()
            .entries
            .len(),
        1
    );
}

#[test]
fn legacy_database_migration_preserves_history_and_cleared_record_ids() {
    for cleared in [false, true] {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.database_path().parent().unwrap()).unwrap();
        let old = rusqlite::Connection::open(fixture.database_path()).unwrap();
        old.execute_batch(
            "CREATE TABLE error_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('proxy','toast')),
            message TEXT NOT NULL, status_code INTEGER);
            CREATE INDEX error_logs_source_id ON error_logs(source, id);
            INSERT INTO error_logs VALUES (42, 'now', 'toast', 'old entry', NULL);",
        )
        .unwrap();
        if cleared {
            old.execute("DELETE FROM error_logs", []).unwrap();
        }
        drop(old);
        let mut upgraded = database::open(&fixture.database_path()).unwrap();
        database::insert(
            &mut upgraded,
            entry(ErrorLogSource::Codex, "install failed"),
        )
        .unwrap();
        let page = database::list(&upgraded, query(10, None, None)).unwrap();
        assert_eq!(page.entries.len(), if cleared { 1 } else { 2 });
        assert!(page.entries[0].id > 42);
        assert_eq!(page.entries[0].source, ErrorLogSource::Codex);
        drop(upgraded);
        assert!(database::open(&fixture.database_path()).is_ok());
    }
}

#[test]
fn entries_survive_reopening_and_serialize_to_the_frontend_contract() {
    let fixture = Fixture::new();
    let mut connection = database::open(&fixture.database_path()).unwrap();
    database::insert(
        &mut connection,
        entry(ErrorLogSource::Proxy, "请求受到限制，请稍后重试。"),
    )
    .unwrap();
    drop(connection);

    let connection = database::open(&fixture.database_path()).unwrap();
    let page = database::list(&connection, query(10, None, None)).unwrap();
    assert_eq!(page.entries.len(), 1);
    let value = serde_json::to_value(page).unwrap();
    assert_eq!(value["hasMore"], false);
    assert_eq!(value["entries"][0]["source"], "proxy");
    assert_eq!(value["entries"][0]["statusCode"], 429);
    assert_eq!(value["entries"][0]["createdAt"], "2026-09-07T01:02:03Z");
}

#[test]
fn pagination_is_newest_first_and_keeps_source_filters_across_cursors() {
    let fixture = Fixture::new();
    let mut connection = database::open(&fixture.database_path()).unwrap();
    for (source, message) in [
        (ErrorLogSource::Proxy, "first"),
        (ErrorLogSource::Toast, "saved"),
        (ErrorLogSource::Proxy, "second"),
        (ErrorLogSource::Proxy, "third"),
    ] {
        database::insert(&mut connection, entry(source, message)).unwrap();
    }

    let first = database::list(&connection, query(2, None, Some(ErrorLogSource::Proxy))).unwrap();
    assert!(first.has_more);
    assert_eq!(
        first
            .entries
            .iter()
            .map(|entry| entry.message.as_str())
            .collect::<Vec<_>>(),
        ["third", "second"]
    );
    database::insert(&mut connection, entry(ErrorLogSource::Proxy, "newest")).unwrap();
    let older = database::list(
        &connection,
        query(2, Some(first.entries[1].id), Some(ErrorLogSource::Proxy)),
    )
    .unwrap();
    assert!(!older.has_more);
    assert_eq!(older.entries.len(), 1);
    assert_eq!(older.entries[0].message, "first");
    assert!(older.entries[0].id < first.entries[1].id);
}

#[test]
fn bounded_retention_removes_old_entries_and_clear_preserves_monotonic_ids() {
    let fixture = Fixture::new();
    let mut connection = database::open(&fixture.database_path()).unwrap();
    connection.execute(
        "WITH RECURSIVE counter(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM counter WHERE id < ?1)
         INSERT INTO error_logs(created_at, source, message) SELECT 'now', 'toast', 'saved' FROM counter",
        [MAX_ENTRIES + 2],
    ).unwrap();
    database::insert(&mut connection, entry(ErrorLogSource::Proxy, "latest")).unwrap();
    let (count, earliest): (i64, i64) = connection
        .query_row("SELECT COUNT(*), MIN(id) FROM error_logs", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!(count, MAX_ENTRIES);
    assert_eq!(earliest, 4);
    let previous_id = database::list(&connection, query(1, None, None))
        .unwrap()
        .entries[0]
        .id;
    database::clear(&connection).unwrap();
    assert!(database::list(&connection, query(1, None, None))
        .unwrap()
        .entries
        .is_empty());
    database::insert(&mut connection, entry(ErrorLogSource::Toast, "saved again")).unwrap();
    assert!(
        database::list(&connection, query(1, None, None))
            .unwrap()
            .entries[0]
            .id
            > previous_id
    );
}

#[test]
fn query_validation_rejects_unbounded_pages_and_invalid_cursors() {
    for limit in [0, 201, u32::MAX] {
        assert!(ListQuery::new(Some(limit), None, None).is_err());
    }
    for cursor in [0, -1] {
        assert!(ListQuery::new(None, Some(cursor), None).is_err());
    }
    assert_eq!(ListQuery::new(None, None, None).unwrap().limit, 100);
    assert!(serde_json::from_value::<ErrorLogSource>(serde_json::json!("other")).is_err());
}

#[test]
fn messages_keep_natural_text_and_bound_unicode_without_partial_characters() {
    assert_eq!(
        sanitize::message(" \n 已保存\t 设置。 "),
        Some("已保存 设置。".to_string())
    );
    assert_eq!(sanitize::message(" \n\t "), None);
    let message = sanitize::message(&"好".repeat(10_000)).unwrap();
    assert_eq!(message.chars().count(), sanitize::MAX_MESSAGE_CHARS);
}

#[test]
fn messages_redact_credentials_urls_and_quoted_absolute_paths() {
    for secret in [
        "Authorization: Bearer private-bearer-value",
        "api_key=private-api-value",
        "{\"access_token\":\"private-access-value\"}",
        "refresh_token: private-refresh-value",
        "password='private-password-value'",
        "clientSecret=private-client-value",
        "refreshToken=private-refresh-value",
        "Bearer private-bearer-value",
        "'(Bearer private-bearer-value)'",
        "sk-private-secret-value",
        "eyJprivate.jwt.signature",
        "https://private-user:private-password@example.com/a?token=private-url-token",
        "'C:\\Users\\Private User\\auth.json'",
        "'/home/private-user/auth.json'",
        "'\\\\private-server\\folder\\auth.json'",
    ] {
        let normalized = sanitize::message(&format!("发生错误： {secret}，请稍后重试。")).unwrap();
        assert!(
            !normalized.to_lowercase().contains("private"),
            "{normalized}"
        );
        assert!(normalized.contains("隐藏"), "{normalized}");
    }
}

#[test]
fn worker_persists_toasts_and_orders_list_and_clear_after_pending_proxy_entries() {
    let fixture = Fixture::new();
    let service = LogService::start(fixture.database_path()).unwrap();
    service.record_proxy("请求失败", Some(502));
    service.record_toast("保存成功").unwrap();
    let page = service.list(query(10, None, None)).unwrap();
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.entries[0].source, ErrorLogSource::Toast);
    assert_eq!(page.entries[1].status_code, Some(502));
    service.clear().unwrap();
    assert!(service
        .list(query(10, None, None))
        .unwrap()
        .entries
        .is_empty());
    service.shutdown_for_test().unwrap();
}

#[test]
fn basic_authorization_redacts_the_scheme_and_complete_credential() {
    let value = sanitize::message("Authorization: Basic dXNlcjpwYXNz\n请求失败").unwrap();
    assert!(!value.contains("dXNlcjpwYXNz"));
    assert!(!value.contains("Basic"));
    assert!(value.contains("请求失败"));
}

#[test]
fn network_urls_are_hidden_without_being_misidentified_as_local_paths() {
    for scheme in ["http", "https"] {
        let input = format!(
            "Cloud login failed: error sending request for url \
             ({scheme}://private-user:private-password@example.com/auth/login?token=private-token)"
        );
        let message = sanitize::message(&input).unwrap();
        assert!(message.contains("[已隐藏]"), "{message}");
        assert!(!message.contains("本地路径"), "{message}");
        assert!(!message.contains("private"), "{message}");
        assert!(!message.contains("example.com"), "{message}");
    }
}

#[test]
fn cookie_headers_redact_every_cookie_value() {
    for field in ["Cookie", "Set-Cookie"] {
        let value = sanitize::message(&format!(
            "{field}: session=short-secret; csrf=second-secret\n请求失败"
        ))
        .unwrap();
        assert!(!value.contains("short-secret"));
        assert!(!value.contains("second-secret"));
        assert!(value.contains("请求失败"));
    }
}

#[test]
fn quoted_credentials_skip_escaped_quotes_without_leaking_the_tail() {
    for message in [
        r#"password="abc\"secret-suffix" 请求失败"#,
        r#"{"api_key":"abc\"secret-suffix","message":"请求失败"}"#,
        r#"password='abc\'secret-suffix' 请求失败"#,
    ] {
        let value = sanitize::message(message).unwrap();
        assert!(!value.contains("abc"), "{value}");
        assert!(!value.contains("secret-suffix"), "{value}");
        assert!(value.contains("请求失败"));
    }
}

#[test]
fn database_failures_return_only_safe_errors() {
    let fixture = Fixture::new();
    fs::create_dir_all(&fixture.0).unwrap();
    fs::write(fixture.database_path(), "not a database").unwrap();
    let service = LogService::start(fixture.database_path()).unwrap();
    let error = service.record_toast("保存成功").unwrap_err();
    assert!(!error
        .to_string()
        .contains(&fixture.0.to_string_lossy().to_string()));
    assert!(error.to_string().contains("稍后重试"));
    service.shutdown_for_test().unwrap();
}
