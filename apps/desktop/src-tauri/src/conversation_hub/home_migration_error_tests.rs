use super::super::home_migration::HomeMigrationError;
use super::super::home_migration_error::{MigrationFailure, MigrationRecovery, MigrationStage};
use super::super::home_migration_reason::MigrationReason;
use super::home_migration::{migrate, source_fixture};
use super::*;

#[test]
fn migration_failure_distinguishes_causes_without_exposing_raw_details() {
    for (detail, expected) in [
        ("database is locked", MigrationReason::InUse),
        ("database table is locked", MigrationReason::InUse),
        (
            "Permission denied (os error 13)",
            MigrationReason::Permission,
        ),
        (
            "No space left on device (os error 28)",
            MigrationReason::DiskFull,
        ),
        ("no such table: thread_items", MigrationReason::Incompatible),
        (
            "no such column: model_provider",
            MigrationReason::Incompatible,
        ),
        ("file is not a database", MigrationReason::Corrupt),
        (
            "No such file or directory (os error 2)",
            MigrationReason::MissingFile,
        ),
        (
            "会话内容发生变化，请结束任务后重试",
            MigrationReason::Changed,
        ),
        (
            "目标会话列表发生变化，请刷新后重试",
            MigrationReason::Conflict,
        ),
    ] {
        assert_eq!(MigrationReason::classify(detail), expected, "{detail}");
    }
    let failure = MigrationFailure::new(
        MigrationStage::Backup,
        "unrecognized failure at C:\\Users\\private\\.codex; api_key=private-secret",
    );
    let display = failure.to_string();
    assert!(display.contains("备份原对话"));
    assert!(display.contains("原对话未改动"));
    assert!(!display.contains("private"));
    let diagnostic = crate::error_logs::sanitize_diagnostic_message(&failure.diagnostic());
    assert!(diagnostic.contains("unrecognized failure"));
    assert!(diagnostic.contains("C:\\Users\\private\\.codex"));
    assert!(diagnostic.contains("api_key=private-secret"));
}

#[test]
fn target_read_failure_is_reported_before_any_conversation_changes() {
    let source = source_fixture();
    let target = source_fixture();
    let before = source.dump(THREAD);
    fs::write(target.home.join(STATE), b"invalid database").unwrap();
    let error = migrate(&source, &target, &[THREAD]).unwrap_err();
    assert!(error.to_string().contains("读取目标对话"));
    assert!(error.to_string().contains("已损坏"));
    assert!(error.to_string().contains("原对话未改动"));
    assert_eq!(source.dump(THREAD), before);
    assert!(source.entries().is_empty());
}

#[cfg(windows)]
#[test]
fn localized_windows_errors_keep_the_os_reason() {
    for (detail, reason) in [
        (
            "另一个程序正在使用此文件，进程无法访问。(os error 32)",
            MigrationReason::InUse,
        ),
        ("磁盘空间不足。(os error 112)", MigrationReason::DiskFull),
        ("拒绝访问。(os error 5)", MigrationReason::Permission),
    ] {
        assert_eq!(MigrationReason::classify(detail), reason);
    }
}

#[test]
fn failed_rollback_preserves_both_causes_and_does_not_claim_everything_was_restored() {
    let source = source_fixture();
    let target = source_fixture();
    target.discard();
    target.sql(
        STATE,
        "CREATE TRIGGER reject_delete BEFORE DELETE ON threads
        BEGIN SELECT RAISE(ABORT, 'rollback failure'); END;",
    );
    // Let the thread row be written, then reject history so rollback tries to delete it.
    target.sql(
        HISTORY,
        "CREATE TRIGGER reject_history BEFORE INSERT ON thread_items
        BEGIN SELECT RAISE(ABORT, 'primary migration failure'); END;",
    );
    let error = migrate(&source, &target, &[THREAD]).unwrap_err();
    let display = error.to_string();
    assert!(display.contains("部分内容未能还原"));
    assert!(display.contains("暂勿重复迁移"));
    assert!(!display.contains("本次更改已撤销"));
    let HomeMigrationError::Failed(failure) = error else {
        panic!("expected failure")
    };
    assert!(matches!(failure.recovery, MigrationRecovery::Incomplete));
    assert!(failure.detail.contains("primary migration failure"));
    assert!(failure
        .rollback_error
        .as_deref()
        .unwrap()
        .contains("rollback failure"));
    assert!(failure.diagnostic().contains("session=Some(\"thread-a\")"));
    assert!(source.snapshot().path.exists());
    assert!(!source.entries().is_empty());
}
