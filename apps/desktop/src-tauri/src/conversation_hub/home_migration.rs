use super::home_migration_error::{MigrationFailure, MigrationRecovery, MigrationStage};
use super::home_migration_provider::{MigrationDestination, MigrationModelProvider};
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeMigrationRequest {
    home_id: String,
    target_home_id: String,
    session_ids: Vec<String>,
    model_provider: Option<MigrationModelProvider>,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum HomeMigrationError {
    #[error("请选择不同的 Codex Home")]
    SameHome,
    #[error("请至少选择一条会话")]
    EmptySelection,
    #[error(transparent)]
    Failed(#[from] MigrationFailure),
}

#[tauri::command]
pub(crate) async fn migrate_codex_threads_to_home<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    request: HomeMigrationRequest,
) -> Result<MigrationReport, String> {
    let context = format!(
        "source={}; target={}; selected={}; provider={:?}",
        request.home_id,
        request.target_home_id,
        request.session_ids.len(),
        request.model_provider
    );
    let result = tauri::async_runtime::spawn_blocking(move || migrate_request(app, request))
        .await
        .unwrap_or_else(|error| {
            let mut failure = MigrationFailure::new(MigrationStage::Worker, error);
            failure.recovery = MigrationRecovery::Unknown;
            Err(failure.into())
        });
    result.map_err(|error| report_migration_error(&context, &error))
}

fn migrate_request<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: HomeMigrationRequest,
) -> Result<MigrationReport, HomeMigrationError> {
    let source = ThreadContext::new(app.clone(), Some(request.home_id))
        .map_err(|error| MigrationFailure::new(MigrationStage::Source, error))?;
    let target = crate::codex_home::resolve_selected(&app, Some(&request.target_home_id))
        .map_err(|error| MigrationFailure::new(MigrationStage::Destination, error))?;
    let _guard = bin_operation_guard()
        .map_err(|error| MigrationFailure::new(MigrationStage::Backup, error))?;
    let bin =
        bin_root(&source).map_err(|error| MigrationFailure::new(MigrationStage::Backup, error))?;
    let destination = MigrationDestination {
        path: &target,
        model_provider: request.model_provider,
    };
    migrate_between_homes(
        &source.paths.codex_home,
        destination,
        &bin,
        request.session_ids,
    )
}

fn report_migration_error(context: &str, error: &HomeMigrationError) -> String {
    // A short reference lets support match a screenshot to the diagnostic cause.
    let reference = Uuid::new_v4().simple().to_string()[..12].to_owned();
    let detail = match error {
        HomeMigrationError::Failed(failure) => failure.diagnostic(),
        _ => error.to_string(),
    };
    crate::error_logs::record_codex_error(&format!(
        "Conversation migration [{reference}]; {context}; {detail}"
    ));
    format!("{error}\n错误编号：{reference}")
}

fn distinct_homes(source: &Path, target: &Path) -> Result<(), HomeMigrationError> {
    let source = fs::canonicalize(source)
        .map_err(|error| MigrationFailure::new(MigrationStage::Source, error))?;
    let target = fs::canonicalize(target)
        .map_err(|error| MigrationFailure::new(MigrationStage::Destination, error))?;
    if source == target {
        return Err(HomeMigrationError::SameHome);
    }
    Ok(())
}

pub(super) fn migrate_between_homes(
    source: &Path,
    target: MigrationDestination<'_>,
    bin: &Path,
    session_ids: Vec<String>,
) -> Result<MigrationReport, HomeMigrationError> {
    distinct_homes(source, target.path)?;
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err(HomeMigrationError::EmptySelection);
    }
    let snapshots =
        super::home_migration_plan::plan_home_migration(source, target.path, &requested)?;
    let completed = snapshots.len();
    let selected_count = snapshots
        .iter()
        .filter(|item| requested.contains(&item.session_id))
        .count();
    let skipped = requested.len() - selected_count;
    let batch = bin.join(format!("home-migration-{}", Uuid::new_v4()));
    if !snapshots.is_empty() {
        super::home_migration_batch::migrate_home_batch(source, target, &batch, snapshots)?;
    }
    Ok(MigrationReport {
        requested_count: requested.len(),
        migrated_count: completed,
        skipped_count: skipped,
        message: format!(
            "已迁移 {completed} 条会话（含 {} 条关联会话），跳过 {skipped} 条所选会话",
            completed - selected_count
        ),
    })
}

#[cfg(test)]
#[path = "home_migration_logging_tests.rs"]
mod logging_tests;
