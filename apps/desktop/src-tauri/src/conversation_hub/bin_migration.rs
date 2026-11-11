fn merge_bin_snapshots(snapshots: Vec<RolloutSnapshot>) -> Vec<RolloutSnapshot> {
    let mut merged = HashMap::<String, RolloutSnapshot>::new();
    for snapshot in snapshots {
        match merged.entry(snapshot.session_id.clone()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(snapshot);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                entry.get_mut().size_bytes += snapshot.size_bytes;
                entry
                    .get_mut()
                    .physical_paths
                    .extend(snapshot.physical_paths);
            }
        }
    }
    merged.into_values().collect()
}

fn bin_belongs_to_home(item: &BinSnapshot, codex_home: &Path) -> bool {
    safe_relative_path(&item.manifest.relative_rollout_path)
        .is_some_and(|relative| codex_home.join(relative) == item.manifest.original_rollout_path)
}

fn restore_legacy_visibility_backup(manifest: &BinManifest, backup: &mut BinStateBackup) {
    let (Some(visibility), Some(thread)) = (&manifest.state_visibility, &mut backup.thread) else {
        return;
    };
    for (column, cell) in thread.columns.iter().zip(&mut thread.values) {
        *cell = match column.as_str() {
            "rollout_path" => SqliteCell::Text(visibility.rollout_path.clone()),
            "archived" => SqliteCell::Integer(visibility.archived),
            "archived_at" => visibility
                .archived_at
                .map_or(SqliteCell::Null, SqliteCell::Integer),
            "preview" => SqliteCell::Text(visibility.preview.clone()),
            _ => continue,
        };
    }
}

fn legacy_bin_group(item: &BinSnapshot) -> (PathBuf, String) {
    (
        item.folder.parent().unwrap_or(&item.folder).to_path_buf(),
        item.manifest.session_id.clone(),
    )
}

fn live_bin_thread_ids(codex_home: &Path) -> Result<HashSet<String>, String> {
    let mut paths = Vec::new();
    for folder in ROLLOUT_FOLDERS {
        collect_rollout_paths(&codex_home.join(folder), &mut paths)?;
    }
    paths.sort();
    paths.dedup();
    let mut ids = HashSet::new();
    for logical in paths {
        let Some(path) = preferred_rollout_path(&logical) else {
            continue;
        };
        if let Some(id) = first_rollout_value(&path)?.as_ref().and_then(snapshot_id) {
            ids.insert(id);
        }
    }
    Ok(ids)
}

fn prepare_legacy_bin_backups(
    codex_home: &Path,
    entries: &mut [BinSnapshot],
    live_ids: &HashSet<String>,
) -> Result<(), String> {
    if entries.iter().all(|item| item.manifest.detached) {
        return Ok(());
    }
    let mut backups = HashMap::new();
    for item in entries
        .iter()
        .filter(|item| bin_belongs_to_home(item, codex_home))
    {
        if let Some(backup) = &item.manifest.state_backup {
            backups
                .entry(legacy_bin_group(item))
                .or_insert_with(|| backup.clone());
        }
    }
    // Read all duplicate entries before removing any rows. Older versions stored
    // one manifest per rollout, including snapshots of already-archived rows.
    for item in entries
        .iter()
        .filter(|item| !item.manifest.detached && bin_belongs_to_home(item, codex_home))
    {
        if live_ids.contains(&item.manifest.session_id)
            || backups.contains_key(&legacy_bin_group(item))
            || item.manifest.original_rollout_path.exists()
        {
            continue;
        }
        let mut backup = snapshot_bin_state(codex_home, &item.manifest.session_id)?;
        let original = entries
            .iter()
            .find(|candidate| {
                legacy_bin_group(candidate) == legacy_bin_group(item)
                    && candidate
                        .manifest
                        .state_visibility
                        .as_ref()
                        .is_some_and(|visibility| {
                            bin_rollout_relative(Path::new(&visibility.rollout_path), codex_home)
                                .is_ok()
                        })
            })
            .unwrap_or(item);
        restore_legacy_visibility_backup(&original.manifest, &mut backup);
        backups.insert(legacy_bin_group(item), backup);
    }
    for item in entries
        .iter_mut()
        .filter(|item| bin_belongs_to_home(item, codex_home))
    {
        if item.manifest.state_backup.is_none() {
            if let Some(backup) = backups.get(&legacy_bin_group(item)) {
                item.manifest.state_backup = Some(backup.clone());
                write_bin_manifest(&item.folder, &item.manifest)?;
            }
        }
    }
    Ok(())
}

fn upgrade_legacy_bin_entries(
    codex_home: &Path,
    entries: &mut [BinSnapshot],
) -> Result<(), String> {
    if entries.iter().all(|item| item.manifest.detached) {
        return Ok(());
    }
    let live_ids = live_bin_thread_ids(codex_home)?;
    prepare_legacy_bin_backups(codex_home, entries, &live_ids)?;
    for item in entries.iter_mut().filter(|item| !item.manifest.detached) {
        if !bin_belongs_to_home(item, codex_home) || live_ids.contains(&item.manifest.session_id) {
            continue;
        }
        if let Err(error) = finish_bin_removal(codex_home, &item.manifest.session_id) {
            return Err(with_bin_rollback_error(
                error,
                restore_bin_state(codex_home, &item.manifest),
            ));
        }
        item.manifest.detached = true;
        write_bin_manifest(&item.folder, &item.manifest)?;
    }
    Ok(())
}

fn reconcile_legacy_bin<R: Runtime>(app: &ThreadContext<R>) -> Result<(), String> {
    let _guard = bin_operation_guard()?;
    collect_bin_entries(app)?;
    Ok(())
}
