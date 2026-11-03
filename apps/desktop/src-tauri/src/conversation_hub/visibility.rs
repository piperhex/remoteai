fn current_model_provider(config_path: &Path) -> String {
    let Ok(content) = fs::read_to_string(config_path) else {
        return "openai".to_string();
    };
    content
        .lines()
        .map(str::trim)
        .find_map(|line| {
            let value = line
                .strip_prefix("model_provider")?
                .trim()
                .strip_prefix('=')?
                .trim();
            Some(value.trim_matches(['\'', '"']).trim().to_string())
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "openai".to_string())
}

/// Locate the newest metadata schema within the caller's already resolved Codex home.
pub(crate) fn latest_state_db(codex_home: &Path) -> Option<PathBuf> {
    fs::read_dir(codex_home)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let version = name
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse::<u64>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path)
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let values = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for value in values {
        if value.map_err(|error| error.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn create_visibility_checkpoint<R: Runtime>(
    app: &ThreadContext<R>,
    codex_home: &Path,
    state_db: Option<&Path>,
    snapshots: &[&RolloutSnapshot],
) -> Result<Option<PathBuf>, String> {
    let index_path = codex_home.join(INDEX_NAME);
    if state_db.is_none() && snapshots.is_empty() && !index_path.exists() {
        return Ok(None);
    }
    let root = app
        .app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("codex-thread-backups")
        .join(Utc::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    if let Some(state_db) = state_db {
        fs::copy(
            state_db,
            root.join(state_db.file_name().unwrap_or_default()),
        )
        .map_err(|error| error.to_string())?;
        for suffix in ["-wal", "-shm"] {
            let companion = PathBuf::from(format!("{}{suffix}", state_db.display()));
            if companion.exists() {
                let name = companion.file_name().unwrap_or_default();
                let _ = fs::copy(&companion, root.join(name));
            }
        }
    }
    if index_path.exists() {
        fs::copy(&index_path, root.join(INDEX_NAME)).map_err(|error| error.to_string())?;
    }
    for snapshot in snapshots {
        let target = root.join("rollouts").join(&snapshot.relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(&snapshot.path, &target).map_err(|error| error.to_string())?;
    }
    Ok(Some(root))
}

fn rewrite_rollout_provider(path: &Path, target_provider: &str) -> Result<bool, String> {
    crate::rollout_metadata::update_provider(path, None, target_provider)
        .map_err(|error| error.to_string())
}

fn rollout_needs_provider_update(path: &Path, provider: &str) -> bool {
    first_rollout_value(path)
        .ok()
        .flatten()
        .is_some_and(|value| {
            !crate::rollout_metadata::requires_stable_bytes(&value)
                && value.pointer("/payload/model_provider").and_then(Value::as_str) != Some(provider)
        })
}

fn rebuild_index_from_snapshots(
    codex_home: &Path,
    snapshots: &[RolloutSnapshot],
) -> Result<usize, String> {
    let existing = index_values(codex_home)?;
    let mut values = Vec::new();
    for item in snapshots {
        let mut value = existing
            .get(&item.session_id)
            .cloned()
            .unwrap_or_else(|| item.index_value.clone());
        if let Some(object) = value.as_object_mut() {
            object.insert("id".to_string(), Value::String(item.session_id.clone()));
            if let Some(name) = item.explicit_name.as_ref() {
                object.insert("thread_name".to_string(), Value::String(name.clone()));
            }
            if let Some(updated_at) = item.updated_at {
                object.insert(
                    "updated_at".to_string(),
                    Value::String(
                        DateTime::<Utc>::from_timestamp(updated_at, 0)
                            .unwrap_or_else(Utc::now)
                            .to_rfc3339(),
                    ),
                );
            }
        }
        values.push(value);
    }
    values.sort_by(|a, b| {
        index_timestamp(Some(b))
            .unwrap_or_default()
            .cmp(&index_timestamp(Some(a)).unwrap_or_default())
    });
    let mut output = String::new();
    for value in values {
        output.push_str(&serde_json::to_string(&value).map_err(|error| error.to_string())?);
        output.push('\n');
    }
    write_text_atomic(&codex_home.join(INDEX_NAME), &output)?;
    Ok(snapshots.len())
}

fn update_main_state(
    state_db: &Path,
    target_provider: &str,
    selected: Option<&HashSet<String>>,
    dry_run: bool,
) -> Result<usize, String> {
    let connection =
        Connection::open(state_db).map_err(|error| format!("无法打开 Codex state DB：{error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    if !table_has_column(&connection, "threads", "model_provider")? {
        return Ok(0);
    }
    let mut changed = 0usize;
    let ids = if let Some(selected) = selected {
        selected.iter().cloned().collect::<Vec<_>>()
    } else {
        let mut statement = connection
            .prepare("SELECT id FROM threads WHERE model_provider != ?1 OR model_provider IS NULL")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![target_provider], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };
    for id in ids {
        let differs = connection
            .query_row(
                "SELECT model_provider != ?1 OR model_provider IS NULL FROM threads WHERE id = ?2",
                params![target_provider, id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or(false);
        if differs {
            changed += 1;
            if !dry_run {
                connection
                    .execute(
                        "UPDATE threads SET model_provider = ?1 WHERE id = ?2",
                        params![target_provider, id],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(changed)
}

fn update_catalogs(
    codex_home: &Path,
    provider: &str,
    ids: &HashSet<String>,
    dry_run: bool,
) -> Result<usize, String> {
    let directory = codex_home.join("sqlite");
    if !directory.exists() {
        return Ok(0);
    }
    let mut changed = 0usize;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let connection = Connection::open(&path).map_err(|error| error.to_string())?;
        if !table_has_column(&connection, "local_thread_catalog", "model_provider")? {
            continue;
        }
        for id in ids {
            let differs = connection
                .query_row(
                    concat!(
                        "SELECT model_provider != ?1 OR model_provider IS NULL ",
                        "FROM local_thread_catalog WHERE thread_id = ?2"
                    ),
                    params![provider, id],
                    |row| row.get::<_, bool>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .unwrap_or(false);
            if differs {
                changed += 1;
                if !dry_run {
                    connection
                        .execute(
                            "UPDATE local_thread_catalog SET model_provider = ?1 WHERE thread_id = ?2",
                            params![provider, id],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(changed)
}

pub(crate) fn reconcile_codex_thread_visibility_blocking<R: Runtime>(
    app: ThreadContext<R>,
    mode: String,
    session_ids: Option<Vec<String>>,
    dry_run: bool,
) -> Result<VisibilityReport, String> {
    let paths = app.paths.clone();
    let mode = if mode == "deep" { "deep" } else { "quick" }.to_string();
    let snapshots = gather_snapshots(&paths.codex_home)?;
    let selected = session_ids
        .map(normalized_ids)
        .filter(|values| !values.is_empty());
    let relevant = snapshots
        .iter()
        .filter(|item| {
            selected
                .as_ref()
                .is_none_or(|ids| ids.contains(&item.session_id))
        })
        .collect::<Vec<_>>();
    let provider = current_model_provider(&paths.current_config);
    let state_db = latest_state_db(&paths.codex_home);
    let backup = if dry_run {
        None
    } else {
        create_visibility_checkpoint(&app, &paths.codex_home, state_db.as_deref(), &relevant)?
    };
    let database_row_count = state_db
        .as_deref()
        .map(|path| update_main_state(path, &provider, selected.as_ref(), dry_run))
        .transpose()?
        .unwrap_or(0);
    let relevant_ids = relevant
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    let catalog_row_count = update_catalogs(&paths.codex_home, &provider, &relevant_ids, dry_run)?;
    let mut rollout_count = 0usize;
    if !dry_run {
        for snapshot in &relevant {
            rollout_count += usize::from(rewrite_rollout_provider(&snapshot.path, &provider)?);
        }
    } else {
        rollout_count = relevant
            .iter()
            .filter(|item| rollout_needs_provider_update(&item.path, &provider))
            .count();
    }
    let index_entry_count = if mode == "deep" && !dry_run {
        rebuild_index_from_snapshots(&paths.codex_home, &snapshots)?
    } else if mode == "deep" {
        snapshots.len()
    } else {
        0
    };
    let changed = database_row_count + catalog_row_count + rollout_count;
    Ok(VisibilityReport {
        mode,
        scanned_count: relevant.len(),
        rollout_count,
        database_row_count,
        catalog_row_count,
        index_entry_count,
        backup_dir: backup.map(|path| path.to_string_lossy().to_string()),
        dry_run,
        message: if dry_run {
            format!("预计校正 {changed} 处会话可见性记录")
        } else {
            format!("已校正 {changed} 处会话可见性记录")
        },
    })
}

pub(crate) fn rebuild_codex_thread_index_blocking<R: Runtime>(
    app: ThreadContext<R>,
) -> Result<VisibilityReport, String> {
    let paths = app.paths.clone();
    let snapshots = gather_snapshots(&paths.codex_home)?;
    let backup = create_visibility_checkpoint(&app, &paths.codex_home, None, &[])?;
    let count = rebuild_index_from_snapshots(&paths.codex_home, &snapshots)?;
    Ok(VisibilityReport {
        mode: "sync".to_string(),
        scanned_count: snapshots.len(),
        rollout_count: 0,
        database_row_count: 0,
        catalog_row_count: 0,
        index_entry_count: count,
        backup_dir: backup.map(|path| path.to_string_lossy().to_string()),
        dry_run: false,
        message: format!("已同步 {} 条会话索引", count),
    })
}

pub(crate) fn open_codex_thread_file_blocking<R: Runtime>(
    app: ThreadContext<R>,
    session_id: String,
    folder_only: bool,
) -> Result<(), String> {
    let codex_home = app.paths.codex_home.clone();
    let snapshot = gather_snapshots(&codex_home)?
        .into_iter()
        .find(|item| item.session_id == session_id)
        .ok_or_else(|| "未找到所选会话文件".to_string())?;
    let path = if folder_only {
        snapshot.path.parent().unwrap_or(&codex_home).to_path_buf()
    } else {
        snapshot.path
    };
    app.app
        .opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("无法打开 {}：{error}", path.display()))
}
