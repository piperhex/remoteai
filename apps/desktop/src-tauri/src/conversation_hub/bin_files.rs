fn bin_rollout_relative(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let relative = path
        .strip_prefix(root)
        .ok()
        .and_then(|path| safe_relative_path(&path.to_string_lossy()))
        .filter(|path| {
            ROLLOUT_FOLDERS
                .iter()
                .any(|folder| path.starts_with(folder))
        })
        .filter(|path| logical_rollout_path(path).is_some());
    relative.ok_or_else(|| "会话文件不在有效的会话目录中".to_string())
}

fn move_bin_file(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        return Err("目标位置已有同名会话，请先处理后重试".to_string());
    }
    let parent = target.parent().ok_or_else(|| "会话目录无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            copy_bin_file(source, target)
        }
        Err(error) => Err(format!("无法移动会话文件：{error}")),
    }
}

fn copy_bin_file(source: &Path, target: &Path) -> Result<(), String> {
    let mut input = File::open(source).map_err(|error| error.to_string())?;
    let mut output = File::options()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| error.to_string())?;
    let copied = std::io::copy(&mut input, &mut output)
        .and_then(|_| output.sync_all())
        .map_err(|error| error.to_string());
    drop(output);
    drop(input);
    let result = copied.and_then(|()| {
        if sha256(source)? != sha256(target)? {
            return Err("会话文件在移动时发生变化，请等待会话结束后重试".to_string());
        }
        fs::remove_file(source).map_err(|error| error.to_string())
    });
    if let Err(error) = result {
        fs::remove_file(target)
            .map_err(|cleanup| format!("{error}；无法清理未完成的副本：{cleanup}"))?;
        return Err(error);
    }
    Ok(())
}

fn rollback_bin_files(moved: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut failures = Vec::new();
    for (source, target) in moved.iter().rev() {
        if let Err(error) = move_bin_file(target, source) {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}

fn move_bin_files(targets: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (index, (source, target)) in targets.iter().enumerate() {
        if let Err(error) = move_bin_file(source, target) {
            return Err(with_bin_rollback_error(
                error,
                rollback_bin_files(&targets[..index]),
            ));
        }
    }
    Ok(())
}

fn with_bin_rollback_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(detail) => format!("{error}；部分内容未能还原，回收站备份已保留：{detail}"),
    }
}

fn write_bin_manifest(folder: &Path, manifest: &BinManifest) -> Result<(), String> {
    let text = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    write_text_atomic(&folder.join("manifest.json"), &format!("{text}\n"))
}

fn bin_manifest_for_snapshot(
    codex_home: &Path,
    snapshot: RolloutSnapshot,
) -> Result<BinManifest, String> {
    let backup = snapshot_bin_state(codex_home, &snapshot.session_id)?;
    let original = rollout_selection::primary(&snapshot, backup.thread.as_ref())?;
    let original = original.clone();
    let relative = bin_rollout_relative(&original, codex_home)?;
    Ok(BinManifest {
        session_id: snapshot.session_id,
        title: snapshot.title,
        cwd: snapshot.cwd,
        original_rollout_path: original,
        relative_rollout_path: relative.to_string_lossy().to_string(),
        session_index_entry: snapshot.index_value,
        deleted_at: Utc::now().to_rfc3339(),
        state_visibility: None,
        state_backup: Some(backup),
        detached: false,
    })
}

fn discard_thread_snapshot(
    codex_home: &Path,
    batch: &Path,
    snapshot: RolloutSnapshot,
) -> Result<(), String> {
    let folder = batch.join(format!(
        "{}--{}",
        safe_name(&snapshot.session_id),
        Uuid::new_v4()
    ));
    let targets = snapshot
        .physical_paths
        .iter()
        .map(|source| {
            let relative = bin_rollout_relative(source, codex_home)?;
            Ok((source.clone(), folder.join("files").join(relative)))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut manifest = bin_manifest_for_snapshot(codex_home, snapshot)?;
    write_bin_manifest(&folder, &manifest)?;
    move_bin_files(&targets)?;
    let removal = finish_bin_removal(codex_home, &manifest.session_id).and_then(|()| {
        manifest.detached = true;
        write_bin_manifest(&folder, &manifest)
    });
    if let Err(error) = removal {
        let error = with_bin_rollback_error(error, restore_bin_state(codex_home, &manifest));
        let error = with_bin_rollback_error(
            error,
            append_index_entry(
                codex_home,
                &manifest.session_id,
                &manifest.session_index_entry,
            ),
        );
        return Err(with_bin_rollback_error(error, rollback_bin_files(&targets)));
    }
    Ok(())
}

fn finish_bin_removal(codex_home: &Path, session_id: &str) -> Result<(), String> {
    remove_bin_state(codex_home, session_id)?;
    rewrite_index(codex_home, &HashSet::from([session_id.to_string()]))
}

fn recover_bin_snapshot(codex_home: &Path, item: &BinSnapshot) -> Result<bool, String> {
    if snapshot_thread_row(
        latest_state_db(codex_home).as_deref(),
        &item.manifest.session_id,
    )?
    .is_some()
        || gather_snapshots(codex_home)?
            .iter()
            .any(|snapshot| snapshot.session_id == item.manifest.session_id)
    {
        return Ok(false);
    }
    recover_bin_files(codex_home, item)
}

fn bin_restore_targets(
    codex_home: &Path,
    item: &BinSnapshot,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    item.rollouts
        .iter()
        .map(|source| {
            let relative = bin_rollout_relative(source, &item.folder.join("files"))?;
            Ok((source.clone(), codex_home.join(relative)))
        })
        .collect()
}

fn recover_additional_bin_files(codex_home: &Path, item: &BinSnapshot) -> Result<bool, String> {
    let targets = bin_restore_targets(codex_home, item)?;
    if targets.is_empty() || targets.iter().any(|(_, target)| target.exists()) {
        return Ok(false);
    }
    // Earlier entries have already restored this session's state. A later
    // duplicate must never replace or roll back those successfully restored rows.
    move_bin_files(&targets)?;
    fs::remove_dir_all(&item.folder)
        .map_err(|error| format!("会话已恢复，但未能清理回收站条目：{error}"))?;
    Ok(true)
}

fn recover_bin_files(codex_home: &Path, item: &BinSnapshot) -> Result<bool, String> {
    let targets = bin_restore_targets(codex_home, item)?;
    if targets.is_empty() || targets.iter().any(|(_, target)| target.exists()) {
        return Ok(false);
    }
    move_bin_files(&targets)?;
    let restore = restore_recovered_bin_state(codex_home, item).and_then(|()| {
        append_index_entry(
            codex_home,
            &item.manifest.session_id,
            &item.manifest.session_index_entry,
        )
    });
    if let Err(error) = restore {
        let error = with_bin_rollback_error(
            error,
            finish_bin_removal(codex_home, &item.manifest.session_id),
        );
        return Err(with_bin_rollback_error(error, rollback_bin_files(&targets)));
    }
    fs::remove_dir_all(&item.folder)
        .map_err(|error| format!("会话已恢复，但未能清理回收站条目：{error}"))?;
    Ok(true)
}
