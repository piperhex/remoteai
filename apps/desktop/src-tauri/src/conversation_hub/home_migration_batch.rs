use super::home_migration_error::{MigrationFailure, MigrationRecovery, MigrationStage};
use super::home_migration_provider::MigrationDestination;
use super::*;

struct PreparedSession {
    backup: BinSnapshot,
    source_files: Vec<(PathBuf, PathBuf)>,
    target_before: BinManifest,
    target_index: Option<Value>,
    target_files: Vec<(PathBuf, PathBuf)>,
    created_files: Vec<PathBuf>,
    target_touched: bool,
    source_touched: bool,
}

/// Copy and verify the entire batch before removing anything from the source.
/// Original manifests remain durable until every related thread has committed.
pub(super) fn migrate_home_batch(
    source: &Path,
    target: MigrationDestination<'_>,
    batch: &Path,
    snapshots: Vec<RolloutSnapshot>,
) -> Result<(), MigrationFailure> {
    let mut prepared = Vec::new();
    for snapshot in snapshots {
        let id = snapshot.session_id.clone();
        match prepare_session(source, target.path, batch, snapshot) {
            Ok(item) => prepared.push(item),
            Err(error) => return Err(cleanup_batch_error(batch, error.for_session(&id))),
        }
    }
    let result = restore_batch_target(target, &mut prepared)
        .and_then(|()| remove_batch_source(source, &mut prepared));
    if let Err(mut error) = result {
        let rollback = rollback_batch(source, target.path, &prepared);
        return Err(match rollback {
            Ok(()) => {
                error.recovery = MigrationRecovery::Restored;
                cleanup_batch_error(batch, error)
            }
            Err(rollback) => {
                error.recovery = MigrationRecovery::Incomplete;
                error.rollback_error = Some(rollback);
                error
            }
        });
    }
    // A cleanup failure must not misreport a committed migration as a failure.
    if let Err(error) = fs::remove_dir_all(batch) {
        crate::error_logs::record_codex_error(&format!(
            "Conversation migration completed; backup cleanup failed: {error}"
        ));
    }
    Ok(())
}

fn cleanup_batch_error(batch: &Path, mut error: MigrationFailure) -> MigrationFailure {
    if !batch.exists() {
        return error;
    }
    error.cleanup_error = fs::remove_dir_all(batch)
        .err()
        .map(|error| error.to_string());
    error
}

fn prepare_session(
    source: &Path,
    target: &Path,
    batch: &Path,
    snapshot: RolloutSnapshot,
) -> Result<PreparedSession, MigrationFailure> {
    let backup_error = |error| MigrationFailure::new(MigrationStage::Backup, error);
    let folder = batch.join(Uuid::new_v4().to_string());
    let mut source_files = Vec::new();
    for path in &snapshot.physical_paths {
        let relative = bin_rollout_relative(path, source).map_err(backup_error)?;
        let backup = folder.join("files").join(relative);
        copy_verified_file(path, &backup).map_err(backup_error)?;
        source_files.push((path.clone(), backup));
    }
    let manifest = bin_manifest_for_snapshot(source, snapshot).map_err(backup_error)?;
    write_bin_manifest(&folder, &manifest).map_err(backup_error)?;
    let mut target_before = manifest.clone();
    let target_error = |error| MigrationFailure::new(MigrationStage::ReadDestination, error);
    target_before.state_backup =
        Some(snapshot_bin_state(target, &manifest.session_id).map_err(target_error)?);
    let target_index = index_values(target)
        .map_err(target_error)?
        .remove(&manifest.session_id);
    Ok(PreparedSession {
        backup: BinSnapshot {
            folder,
            manifest,
            rollouts: source_files.iter().map(|(_, path)| path.clone()).collect(),
        },
        source_files,
        target_before,
        target_index,
        target_files: Vec::new(),
        created_files: Vec::new(),
        target_touched: false,
        source_touched: false,
    })
}

pub(super) fn copy_verified_file(source: &Path, target: &Path) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| "迁移目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut input = File::open(source).map_err(|error| error.to_string())?;
    let mut output = File::options()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| error.to_string())?;
    let copied = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all());
    drop(output);
    let verified = copied.map_err(|error| error.to_string()).and_then(|_| {
        if sha256(source)? == sha256(target)? {
            Ok(())
        } else {
            Err("会话内容发生变化，请结束任务后重试".to_string())
        }
    });
    if let Err(error) = verified {
        return Err(with_bin_rollback_error(
            error,
            fs::remove_file(target).map_err(|error| error.to_string()),
        ));
    }
    Ok(())
}

fn restore_batch_target(
    destination: MigrationDestination<'_>,
    prepared: &mut [PreparedSession],
) -> Result<(), MigrationFailure> {
    let target = destination.path;
    let mut available = super::home_migration_plan::target_session_ids(target)
        .map_err(|error| MigrationFailure::new(MigrationStage::ReadDestination, error))?;
    available.extend(
        prepared
            .iter()
            .map(|item| item.backup.manifest.session_id.clone()),
    );
    for item in prepared.iter_mut() {
        copy_target_session(destination, item).map_err(|error| {
            MigrationFailure::new(MigrationStage::WriteDestinationFiles, error)
                .for_session(&item.backup.manifest.session_id)
        })?;
    }
    // Every history file must exist before a thread becomes visible in the
    // destination database, including bases stored in another rollout.
    for item in prepared {
        restore_target_session(destination, item, &available).map_err(|error| {
            MigrationFailure::new(MigrationStage::WriteDestinationHistory, error)
                .for_session(&item.backup.manifest.session_id)
        })?;
    }
    Ok(())
}

fn copy_target_session(
    destination: MigrationDestination<'_>,
    item: &mut PreparedSession,
) -> Result<(), String> {
    for (source, path) in bin_restore_targets(destination.path, &item.backup)? {
        copy_verified_file(&source, &path)?;
        // Register before rewriting so a failed rewrite is rolled back too.
        item.created_files.push(path.clone());
        if let Some(provider) = destination.model_provider {
            rewrite_rollout_provider(&path, provider.as_str())?;
        }
    }
    Ok(())
}

fn restore_target_session(
    destination: MigrationDestination<'_>,
    item: &mut PreparedSession,
    available: &HashSet<String>,
) -> Result<(), String> {
    let target = destination.path;
    let mut manifest = relocated_bin_manifest(target, &item.backup.manifest)?;
    if let Some(provider) = destination.model_provider {
        provider.apply_to_manifest(&mut manifest);
    }
    if snapshot_thread_row(latest_state_db(target).as_deref(), &manifest.session_id)?.is_some() {
        return Err("目标会话列表发生变化，请刷新后重试".to_string());
    }
    retain_available_edges(&mut manifest, available);
    item.target_touched = true;
    restore_bin_state(target, &manifest)?;
    append_index_entry(target, &manifest.session_id, &manifest.session_index_entry)
}

fn retain_available_edges(manifest: &mut BinManifest, available: &HashSet<String>) {
    let Some(backup) = &mut manifest.state_backup else {
        return;
    };
    for table in backup
        .tables
        .iter_mut()
        .filter(|table| table.table == "thread_spawn_edges")
    {
        table.rows.retain(|row| {
            ["parent_thread_id", "child_thread_id"]
                .iter()
                .all(|column| sqlite_row_text(row, column).is_some_and(|id| available.contains(id)))
        });
    }
}

fn remove_batch_source(
    source: &Path,
    prepared: &mut [PreparedSession],
) -> Result<(), MigrationFailure> {
    // Verify every source again before the first removal; an active session may
    // have appended records while the destination was being prepared.
    for item in prepared.iter() {
        verify_source_session(item).map_err(|error| {
            MigrationFailure::new(MigrationStage::VerifySource, error)
                .for_session(&item.backup.manifest.session_id)
        })?;
    }
    for item in prepared {
        item.source_touched = true;
        remove_source_session(source, item).map_err(|error| {
            MigrationFailure::new(MigrationStage::RemoveSource, error)
                .for_session(&item.backup.manifest.session_id)
        })?;
    }
    Ok(())
}

fn verify_source_session(item: &PreparedSession) -> Result<(), String> {
    for (path, backup) in &item.source_files {
        if sha256(path)? != sha256(backup)? {
            return Err("会话内容发生变化，请结束任务后重试".to_string());
        }
    }
    Ok(())
}

fn remove_source_session(source: &Path, item: &PreparedSession) -> Result<(), String> {
    for (path, _) in &item.source_files {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    finish_bin_removal(source, &item.backup.manifest.session_id)
}

fn rollback_batch(
    source: &Path,
    target: &Path,
    prepared: &[PreparedSession],
) -> Result<(), String> {
    let mut failures = Vec::new();
    // Restore all source manifests after the removals so an edge shared by two
    // sessions is restored from the original, complete snapshot.
    for item in prepared.iter().filter(|item| item.source_touched) {
        if let Err(error) = restore_source(source, item) {
            failures.push(format!(
                "restore source session {}: {error}",
                item.backup.manifest.session_id
            ));
        }
    }
    for item in prepared.iter().rev() {
        if let Err(error) = rollback_target(target, item) {
            failures.push(format!(
                "restore target session {}: {error}",
                item.backup.manifest.session_id
            ));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}

fn restore_source(source: &Path, item: &PreparedSession) -> Result<(), String> {
    for (path, backup) in &item.source_files {
        if !path.exists() {
            copy_verified_file(backup, path)?;
        }
    }
    let manifest = &item.backup.manifest;
    restore_bin_state(source, manifest)?;
    append_index_entry(source, &manifest.session_id, &manifest.session_index_entry)
}

fn rollback_target(target: &Path, item: &PreparedSession) -> Result<(), String> {
    for path in &item.created_files {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    if !item.target_touched {
        return Ok(());
    }
    let id = &item.backup.manifest.session_id;
    finish_bin_removal(target, id)?;
    for (path, backup) in &item.target_files {
        if !path.exists() {
            copy_verified_file(backup, path)?;
        }
    }
    restore_bin_state(target, &item.target_before)?;
    if let Some(entry) = &item.target_index {
        append_index_entry(target, id, entry)?;
    }
    Ok(())
}

/// Apply a prepared synchronization batch, retaining overwritten target data until commit.
pub(super) fn synchronize_batch(
    source: Option<&Path>,
    destination: MigrationDestination<'_>,
    batch: &Path,
    snapshots: Vec<BinSnapshot>,
) -> Result<(), MigrationFailure> {
    let mut existing = merge_bin_snapshots(
        gather_snapshots(destination.path)
            .map_err(|error| MigrationFailure::new(MigrationStage::ReadDestination, error))?,
    )
    .into_iter()
    .map(|item| (item.session_id.clone(), item))
    .collect::<HashMap<_, _>>();
    let mut prepared = Vec::new();
    for snapshot in snapshots {
        let previous = existing.remove(&snapshot.manifest.session_id);
        let options = SyncPreparation {
            source,
            target: destination.path,
            batch,
            existing: previous,
        };
        let item = prepare_sync_session(options, snapshot)
            .map_err(|error| MigrationFailure::new(MigrationStage::Backup, error))?;
        prepared.push(item);
    }
    let result = replace_sync_targets(destination.path, &mut prepared)
        .and_then(|()| restore_batch_target(destination, &mut prepared))
        .and_then(|()| match source {
            Some(source) => remove_batch_source(source, &mut prepared),
            None => Ok(()),
        });
    if let Err(mut error) = result {
        error.recovery = MigrationRecovery::Restored;
        if let Err(rollback) = rollback_batch(
            source.unwrap_or(destination.path),
            destination.path,
            &prepared,
        ) {
            error.recovery = MigrationRecovery::Incomplete;
            error.rollback_error = Some(rollback);
        }
        return Err(error);
    }
    Ok(())
}

struct SyncPreparation<'a> {
    source: Option<&'a Path>,
    target: &'a Path,
    batch: &'a Path,
    existing: Option<RolloutSnapshot>,
}

fn prepare_sync_session(
    options: SyncPreparation<'_>,
    backup: BinSnapshot,
) -> Result<PreparedSession, String> {
    let SyncPreparation {
        source,
        target,
        batch,
        existing,
    } = options;
    let id = &backup.manifest.session_id;
    let mut target_files = Vec::new();
    if let Some(snapshot) = &existing {
        for path in &snapshot.physical_paths {
            let saved = batch
                .join("previous")
                .join(id)
                .join(bin_rollout_relative(path, target)?);
            copy_verified_file(path, &saved)?;
            target_files.push((path.clone(), saved));
        }
    }
    let mut target_before = match existing {
        Some(snapshot) => bin_manifest_for_snapshot(target, snapshot)?,
        None => backup.manifest.clone(),
    };
    target_before.state_backup = Some(snapshot_bin_state(target, id)?);
    let previous = batch.join("previous").join(id);
    fs::create_dir_all(&previous).map_err(|error| error.to_string())?;
    write_bin_manifest(&previous, &target_before)?;
    let target_index = index_values(target)?.remove(id);
    let source_files = match source {
        Some(source) => bin_restore_targets(source, &backup)?
            .into_iter()
            .map(|(saved, original)| (original, saved))
            .collect(),
        None => Vec::new(),
    };
    Ok(PreparedSession {
        backup,
        source_files,
        target_before,
        target_index,
        target_files,
        created_files: Vec::new(),
        target_touched: false,
        source_touched: false,
    })
}

fn replace_sync_targets(
    target: &Path,
    prepared: &mut [PreparedSession],
) -> Result<(), MigrationFailure> {
    for item in prepared {
        item.target_touched = true;
        for (path, _) in &item.target_files {
            fs::remove_file(path).map_err(|error| {
                MigrationFailure::new(MigrationStage::WriteDestinationFiles, error)
            })?;
        }
        finish_bin_removal(target, &item.backup.manifest.session_id).map_err(|error| {
            MigrationFailure::new(MigrationStage::WriteDestinationHistory, error)
        })?;
    }
    Ok(())
}
