use super::*;

#[test]
fn migration_failure_is_persisted_and_included_in_diagnostic_export() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = format!("test.migration.{}", Uuid::new_v4());
    let app = tauri::test::mock_builder().build(context).unwrap();
    crate::error_logs::setup(app.handle()).unwrap();
    let mut failure = MigrationFailure::new(
        MigrationStage::WriteDestinationHistory,
        "database is locked; path=\"C:\\private\\state.sqlite\"; api_key=private-value",
    );
    failure.recovery = MigrationRecovery::Incomplete;
    failure.rollback_error = Some("rollback sharing violation (os error 32)".into());
    let message = report_migration_error(
        "source=default; target=codex-gui; selected=54",
        &failure.into(),
    );
    let reference = message.split("错误编号：").nth(1).unwrap();
    let page = crate::error_logs::export_errors(crate::error_logs::ErrorLogSource::Codex).unwrap();
    let entry = page
        .entries
        .iter()
        .find(|entry| entry.message.contains(reference))
        .unwrap();
    for expected in [
        "selected=54",
        "WriteDestinationHistory",
        "database is locked",
        "rollback sharing violation",
        "C:\\private\\state.sqlite",
        "api_key=private-value",
    ] {
        assert!(entry.message.contains(expected), "{}", entry.message);
    }
    assert!(!message.contains("database"));
    let export =
        std::env::temp_dir().join(format!("migration-diagnostics-{}.jsonl", Uuid::new_v4()));
    tauri::async_runtime::block_on(crate::local_proxy::export_diagnostic_logs(
        app.handle().clone(),
        export.to_string_lossy().into_owned(),
    ))
    .unwrap();
    let content = fs::read_to_string(&export).unwrap();
    let records = content
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert!(records
        .iter()
        .any(|record| record["event"] == "codex_error_history"
            && record["record"]["message"]
                .as_str()
                .is_some_and(|message| message.contains(reference))));
    assert!(content.contains("api_key=private-value"));
    fs::remove_file(export).unwrap();
}
