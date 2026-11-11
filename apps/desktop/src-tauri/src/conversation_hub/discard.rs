pub(crate) fn discard_codex_threads_blocking<R: Runtime>(
    app: ThreadContext<R>,
    session_ids: Vec<String>,
) -> Result<MutationReport, String> {
    let _guard = bin_operation_guard()?;
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let paths = app.paths.clone();
    let all_snapshots = gather_snapshots(&paths.codex_home)?;
    let state_db = latest_state_db(&paths.codex_home);
    ensure_threads_are_not_referenced(&all_snapshots, &requested, state_db.as_deref())?;
    let snapshots = all_snapshots
        .into_iter()
        .filter(|item| requested.contains(&item.session_id))
        .collect::<Vec<_>>();
    if snapshots.is_empty() {
        return Ok(MutationReport {
            requested_count: requested.len(),
            affected_count: 0,
            released_bytes: 0,
            message: "所选会话已不存在".to_string(),
        });
    }
    let batch = bin_root(&app)?.join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&batch).map_err(|error| format!("无法创建会话回收站：{error}"))?;
    let mut moved = HashSet::new();
    for snapshot in merge_bin_snapshots(snapshots) {
        let session_id = snapshot.session_id.clone();
        if let Err(error) = discard_thread_snapshot(&paths.codex_home, &batch, snapshot) {
            return Err(format!(
                "已将 {} 条会话移到回收站，其余会话未完成：{error}",
                moved.len()
            ));
        }
        moved.insert(session_id);
    }
    Ok(MutationReport {
        requested_count: requested.len(),
        affected_count: moved.len(),
        released_bytes: 0,
        message: format!("已将 {} 条会话移到回收站", moved.len()),
    })
}

fn collect_bin_entries<R: Runtime>(app: &ThreadContext<R>) -> Result<Vec<BinSnapshot>, String> {
    let root = bin_root(app)?;
    collect_home_bin_entries(&root, &app.paths.codex_home)
}

fn collect_home_bin_entries(root: &Path, codex_home: &Path) -> Result<Vec<BinSnapshot>, String> {
    let mut entries = collect_bin_entries_at(root)?;
    entries.retain(|item| bin_belongs_to_home(item, codex_home));
    upgrade_legacy_bin_entries(codex_home, &mut entries)?;
    Ok(entries)
}

fn collect_bin_entries_at(root: &Path) -> Result<Vec<BinSnapshot>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for batch in fs::read_dir(root).map_err(|error| format!("无法读取会话回收站：{error}"))?
    {
        let batch = batch.map_err(|error| error.to_string())?.path();
        if !batch.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&batch).map_err(|error| error.to_string())? {
            let folder = entry.map_err(|error| error.to_string())?.path();
            let manifest_path = folder.join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            let manifest: BinManifest = serde_json::from_slice(
                &fs::read(&manifest_path).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("回收站清单损坏 {}：{error}", manifest_path.display()))?;
            let files_root = folder.join("files");
            let mut rollouts = Vec::new();
            collect_physical_rollouts(&files_root, &mut rollouts)?;
            if !rollouts.is_empty() {
                result.push(BinSnapshot {
                    folder,
                    manifest,
                    rollouts,
                });
            }
        }
    }
    Ok(result)
}

fn collect_physical_rollouts(root: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            collect_physical_rollouts(&path, result)?;
        } else if logical_rollout_path(&path).is_some() {
            result.push(path);
        }
    }
    result.sort();
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    if path.is_file() {
        return fs::metadata(path).map(|value| value.len()).unwrap_or(0);
    }
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn latest_versioned_db(codex_home: &Path, prefix: &str) -> Option<PathBuf> {
    fs::read_dir(codex_home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = name
                .strip_prefix(prefix)?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}
