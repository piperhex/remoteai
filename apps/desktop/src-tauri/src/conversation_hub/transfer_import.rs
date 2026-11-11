use super::*;

pub(super) fn read(
    home: &Path,
    path: &Path,
    manifest: &PackageManifest,
    requested: &HashSet<String>,
) -> Result<usize, String> {
    transfer_package::validate(manifest)?;
    fs::create_dir_all(home).map_err(|error| error.to_string())?;
    let existing = gather_snapshots(home)?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut imported = 0;
    for item in manifest
        .sessions
        .iter()
        .filter(|item| requested.contains(&item.session_id))
    {
        if existing.contains(&item.session_id)
            || snapshot_thread_row(latest_state_db(home).as_deref(), &item.session_id)?.is_some()
        {
            continue;
        }
        read_session(home, &mut archive, item)?;
        imported += 1;
    }
    Ok(imported)
}

fn read_session(
    home: &Path,
    archive: &mut ZipArchive<File>,
    item: &PackageItem,
) -> Result<(), String> {
    let staging = tempfile::tempdir_in(home).map_err(|error| error.to_string())?;
    let mut targets = Vec::new();
    for file in transfer_package::files(item) {
        let relative = transfer_package::relative(&file.relative_rollout_path)?;
        let saved = staging.path().join(&relative);
        extract(archive, &saved, &file, item)?;
        targets.push((saved, home.join(relative)));
    }
    validate_targets(home, &targets)?;
    let backup = backup(home, item)?;
    move_bin_files(&targets)?;
    if let Err(error) = restore(home, item) {
        return Err(with_bin_rollback_error(
            error,
            rollback(home, &backup, &targets),
        ));
    }
    Ok(())
}

fn extract(
    archive: &mut ZipArchive<File>,
    saved: &Path,
    file: &PackageRollout,
    item: &PackageItem,
) -> Result<(), String> {
    let mut packaged = archive
        .by_name(&file.file_entry)
        .map_err(|error| format!("会话包文件缺失：{error}"))?;
    if !item.rollouts.is_empty() && packaged.size() != file.size_bytes {
        return Err(synchronization::INVALID.into());
    }
    let parent = saved.parent().ok_or(synchronization::INVALID)?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut output = File::options()
        .write(true)
        .create_new(true)
        .open(saved)
        .map_err(|error| error.to_string())?;
    std::io::copy(&mut packaged, &mut output).map_err(|error| error.to_string())?;
    output.sync_all().map_err(|error| error.to_string())?;
    drop(output);
    if sha256(saved)? != file.sha256 {
        return Err(format!("会话 {} 校验失败", item.session_id));
    }
    if first_rollout_value(saved)
        .map_err(|_| synchronization::INVALID.to_owned())?
        .as_ref()
        .and_then(snapshot_id)
        .as_deref()
        != Some(&item.session_id)
    {
        return Err(synchronization::INVALID.into());
    }
    Ok(())
}

fn validate_targets(home: &Path, targets: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let root = fs::canonicalize(home).map_err(|error| error.to_string())?;
    for (_, target) in targets {
        let existing = target
            .ancestors()
            .find(|path| path.exists())
            .ok_or(synchronization::INVALID)?;
        if target.exists()
            || !fs::canonicalize(existing)
                .map_err(|error| error.to_string())?
                .starts_with(&root)
        {
            return Err(synchronization::INVALID.into());
        }
    }
    Ok(())
}

struct ImportBackup {
    manifest: BinManifest,
    index: Option<Value>,
}

fn backup(home: &Path, item: &PackageItem) -> Result<ImportBackup, String> {
    let index = index_values(home)?.remove(&item.session_id);
    Ok(ImportBackup {
        manifest: BinManifest {
            session_id: item.session_id.clone(),
            title: item.title.clone(),
            cwd: item.cwd.clone(),
            original_rollout_path: home
                .join(transfer_package::relative(&item.relative_rollout_path)?),
            relative_rollout_path: item.relative_rollout_path.clone(),
            session_index_entry: item.session_index_entry.clone(),
            deleted_at: Utc::now().to_rfc3339(),
            state_visibility: None,
            state_backup: Some(snapshot_bin_state(home, &item.session_id)?),
            detached: false,
        },
        index,
    })
}

fn restore(home: &Path, item: &PackageItem) -> Result<(), String> {
    let current = home.join(transfer_package::relative(&item.relative_rollout_path)?);
    restore_thread_row(
        latest_state_db(home).as_deref(),
        item.state_row.as_ref(),
        &current,
        &item.session_id,
    )?;
    restore_related_state(home, &item.related_state, &item.session_id)?;
    append_index_entry(home, &item.session_id, &item.session_index_entry)
}

fn rollback(
    home: &Path,
    backup: &ImportBackup,
    targets: &[(PathBuf, PathBuf)],
) -> Result<(), String> {
    let mut failures = Vec::new();
    for result in [
        finish_bin_removal(home, &backup.manifest.session_id),
        restore_bin_state(home, &backup.manifest),
        backup.index.as_ref().map_or(Ok(()), |entry| {
            append_index_entry(home, &backup.manifest.session_id, entry)
        }),
        rollback_bin_files(targets),
    ] {
        if let Err(error) = result {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}
