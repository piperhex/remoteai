fn selected_snapshots(
    codex_home: &Path,
    ids: &HashSet<String>,
) -> Result<Vec<RolloutSnapshot>, String> {
    let snapshots = gather_snapshots(codex_home)?
        .into_iter()
        .filter(|item| ids.contains(&item.session_id))
        .collect::<Vec<_>>();
    // Dependencies may occur in any segment, not only the first scanned file.
    ensure_export_dependencies(&snapshots)?;
    let state = latest_state_db(codex_home);
    let mut snapshots = merge_bin_snapshots(snapshots);
    snapshots.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    for snapshot in &mut snapshots {
        let row = snapshot_thread_row(state.as_deref(), &snapshot.session_id)?;
        snapshot.path = rollout_selection::primary(snapshot, row.as_ref())?.clone();
        snapshot.relative_path = bin_rollout_relative(&snapshot.path, codex_home)?;
    }
    Ok(snapshots)
}

fn ensure_export_dependencies(snapshots: &[RolloutSnapshot]) -> Result<HashSet<String>, String> {
    let included = snapshots
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    for item in snapshots {
        for dependency in [
            item.history_base_thread_id.as_deref(),
            item.parent_thread_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if !included.contains(dependency) {
                return Err(format!(
                    "会话 {} 依赖会话 {dependency}，请一起选择后再导出",
                    item.session_id
                ));
            }
        }
    }
    Ok(included)
}

pub(crate) fn inspect_codex_thread_export_blocking<R: Runtime>(
    app: ThreadContext<R>,
    session_ids: Vec<String>,
) -> Result<BundlePreview, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let snapshots = selected_snapshots(&app.paths.codex_home.clone(), &requested)?;
    ensure_export_dependencies(&snapshots)?;
    let items = snapshots
        .into_iter()
        .map(|item| BundlePreviewItem {
            session_id: item.session_id,
            title: item.title,
            cwd: item.cwd,
            updated_at: item.updated_at,
            size_bytes: item.size_bytes,
            status: "ready".to_string(),
            reason: None,
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: BUNDLE_REVISION,
        exported_at: None,
        total_count: requested.len(),
        ready_count: items.len(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

pub(crate) fn pack_codex_threads_blocking<R: Runtime>(
    app: ThreadContext<R>,
    session_ids: Vec<String>,
    export_path: String,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条会话".to_string());
    }
    let _guard = bin_operation_guard()?;
    let codex_home = app.paths.codex_home.clone();
    let snapshots = selected_snapshots(&codex_home, &requested)?;
    let destination = PathBuf::from(export_path.trim());
    transfer_package::write(&codex_home, &snapshots, &destination)?;
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: snapshots.len(),
        skipped_count: requested.len().saturating_sub(snapshots.len()),
        path: destination.to_string_lossy().to_string(),
        message: format!("已导出 {} 条会话", snapshots.len()),
    })
}

fn read_package(path: &Path) -> Result<PackageManifest, String> {
    let file = File::open(path).map_err(|error| format!("无法打开会话包：{error}"))?;
    let mut archive = ZipArchive::new(file).map_err(|error| format!("会话包格式无效：{error}"))?;
    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "会话包缺少 manifest.json".to_string())?;
    let mut content = String::new();
    manifest_file
        .read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    let manifest: PackageManifest =
        serde_json::from_str(&content).map_err(|error| format!("会话包清单无效：{error}"))?;
    if manifest.kind != BUNDLE_KIND || !(1..=BUNDLE_REVISION).contains(&manifest.package_version) {
        return Err("不支持此会话包版本".to_string());
    }
    transfer_package::validate(&manifest)?;
    Ok(manifest)
}

pub(crate) fn inspect_codex_thread_import_blocking<R: Runtime>(
    app: ThreadContext<R>,
    import_path: String,
) -> Result<BundlePreview, String> {
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let existing = gather_snapshots(&app.paths.codex_home.clone())?
        .into_iter()
        .map(|item| item.session_id)
        .collect::<HashSet<_>>();
    let items = manifest
        .sessions
        .iter()
        .map(|item| {
            let duplicate = existing.contains(&item.session_id);
            BundlePreviewItem {
                session_id: item.session_id.clone(),
                title: item.title.clone(),
                cwd: item.cwd.clone(),
                updated_at: item.updated_at,
                size_bytes: item.size_bytes,
                status: if duplicate { "duplicate" } else { "ready" }.to_string(),
                reason: duplicate.then(|| "默认实例已存在同 ID 会话".to_string()),
            }
        })
        .collect::<Vec<_>>();
    Ok(BundlePreview {
        package_version: manifest.package_version,
        exported_at: Some(manifest.exported_at),
        total_count: items.len(),
        ready_count: items.iter().filter(|item| item.status == "ready").count(),
        total_size_bytes: items.iter().map(|item| item.size_bytes).sum(),
        items,
    })
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let normalized = value.replace('\\', "/");
    let bytes = normalized.as_bytes();
    let has_windows_drive_prefix = matches!(
        (bytes.first(), bytes.get(1)),
        (Some(drive), Some(b':')) if drive.is_ascii_alphabetic()
    );
    let path = PathBuf::from(normalized);
    (!path.as_os_str().is_empty()
        && !has_windows_drive_prefix
        && !path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_))))
    .then_some(path)
}

pub(crate) fn unpack_codex_threads_blocking<R: Runtime>(
    app: ThreadContext<R>,
    import_path: String,
    session_ids: Vec<String>,
) -> Result<BundleResult, String> {
    let requested = normalized_ids(session_ids);
    if requested.is_empty() {
        return Err("请至少选择一条要导入的会话".to_string());
    }
    let path = PathBuf::from(import_path.trim());
    let manifest = read_package(&path)?;
    let _guard = bin_operation_guard()?;
    let codex_home = app.paths.codex_home.clone();
    let imported = transfer_import::read(&codex_home, &path, &manifest, &requested)?;
    Ok(BundleResult {
        requested_count: requested.len(),
        completed_count: imported,
        skipped_count: requested.len().saturating_sub(imported),
        path: path.to_string_lossy().to_string(),
        message: format!("已导入 {} 条会话", imported),
    })
}
