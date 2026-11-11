use super::super::home_migration_batch::copy_verified_file;
use super::*;

const MANIFEST_LIMIT: u64 = 64 * 1024 * 1024;

pub(super) fn original_size(root: &Path) -> Result<u64, String> {
    let mut total = fs::metadata(root.join("manifest.json"))
        .map_err(|error| error.to_string())?
        .len();
    for item in snapshots(root)? {
        for path in item.rollouts {
            total += fs::metadata(path).map_err(|error| error.to_string())?.len();
        }
    }
    Ok(total)
}

pub(super) fn snapshot_source(source: &Path, root: &Path, ids: Vec<String>) -> Result<(), String> {
    let requested = normalized_ids(ids);
    if requested.is_empty() {
        return Err(INVALID.into());
    }
    let all = merge_bin_snapshots(gather_snapshots(source)?);
    let edges = super::super::thread_relations::edges(source, &all)?;
    let selected = super::super::home_migration_plan::connected_sessions(&all, &edges, &requested);
    if !requested.is_subset(&selected) {
        return Err(CHANGED.into());
    }
    let mut manifests = Vec::new();
    for snapshot in all
        .into_iter()
        .filter(|item| selected.contains(&item.session_id))
    {
        validate_id(&snapshot.session_id)?;
        let folder = root.join("sessions").join(&snapshot.session_id);
        for path in &snapshot.physical_paths {
            let saved = folder
                .join("files")
                .join(bin_rollout_relative(path, source)?);
            copy_verified_file(path, &saved)?;
        }
        let manifest = bin_manifest_for_snapshot(source, snapshot)?;
        write_bin_manifest(&folder, &manifest)?;
        manifests.push(manifest);
    }
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifests).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub(super) fn pack(root: &Path) -> Result<(), String> {
    let file = File::create(root.join("bundle.zip")).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(1));
    zip.start_file("manifest.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&fs::read(root.join("manifest.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for item in snapshots(root)? {
        for path in &item.rollouts {
            let relative = path.strip_prefix(root).map_err(|_| INVALID.to_owned())?;
            zip.start_file(relative.to_string_lossy().replace('\\', "/"), options)
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut File::open(path).map_err(|e| e.to_string())?, &mut zip)
                .map_err(|e| e.to_string())?;
        }
    }
    zip.finish()
        .map_err(|e| e.to_string())?
        .sync_all()
        .map_err(|e| e.to_string())
}

pub(super) fn unpack(entry: &Transfer) -> Result<(), String> {
    let path = entry.root.join("bundle.zip");
    if entry.written != entry.size || sha256(&path)? != entry.sha256 {
        return Err(INVALID.into());
    }
    let sessions = entry.root.join("sessions");
    // An interrupted extraction has no completed manifest and is safe to repeat.
    if !entry.root.join("manifest.json").exists() && sessions.exists() {
        fs::remove_dir_all(sessions).map_err(|error| error.to_string())?;
    }
    let mut zip =
        ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let manifest_file = zip.by_name("manifest.json").map_err(|e| e.to_string())?;
    if manifest_file.size() > MANIFEST_LIMIT {
        return Err(INVALID.into());
    }
    let manifests: Vec<BinManifest> = serde_json::from_reader(manifest_file.take(MANIFEST_LIMIT))
        .map_err(|_| INVALID.to_owned())?;
    validate_manifests(&manifests)?;
    let ids = manifests
        .iter()
        .map(|item| item.session_id.as_str())
        .collect::<HashSet<_>>();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|e| e.to_string())?;
        if file.name() == "manifest.json" {
            continue;
        }
        let relative = safe_relative_path(file.name()).ok_or_else(|| INVALID.to_owned())?;
        let parts = relative
            .iter()
            .map(|part| part.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        if parts.len() < 5
            || parts[0] != "sessions"
            || !ids.contains(parts[1].as_str())
            || parts[2] != "files"
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(INVALID.into());
        }
        let folder = entry.root.join("sessions").join(&parts[1]);
        let target = entry.root.join(&relative);
        bin_rollout_relative(&target, &folder.join("files"))?;
        fs::create_dir_all(target.parent().ok_or_else(|| INVALID.to_owned())?)
            .map_err(|e| e.to_string())?;
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
    }
    for manifest in &manifests {
        write_bin_manifest(
            &entry.root.join("sessions").join(&manifest.session_id),
            manifest,
        )?;
    }
    fs::write(
        entry.root.join("manifest.json"),
        serde_json::to_vec(&manifests).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub(super) fn snapshots(root: &Path) -> Result<Vec<BinSnapshot>, String> {
    let manifests: Vec<BinManifest> =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    validate_manifests(&manifests)?;
    manifests
        .into_iter()
        .map(|manifest| {
            let folder = root.join("sessions").join(&manifest.session_id);
            let mut rollouts = Vec::new();
            for prefix in ROLLOUT_FOLDERS {
                collect_rollout_paths(&folder.join("files").join(prefix), &mut rollouts)?;
            }
            rollouts.sort();
            rollouts.dedup();
            let rollouts = rollouts
                .into_iter()
                .flat_map(|path| rollout_physical_paths(&path))
                .collect::<Vec<_>>();
            validate_rollouts(&manifest, &folder.join("files"), &rollouts)?;
            Ok(BinSnapshot {
                folder,
                manifest,
                rollouts,
            })
        })
        .collect()
}

fn validate_rollouts(manifest: &BinManifest, root: &Path, files: &[PathBuf]) -> Result<(), String> {
    let current = root.join(transfer_package::relative(&manifest.relative_rollout_path)?);
    if !files
        .iter()
        .any(|path| logical_rollout_path(path) == logical_rollout_path(&current))
    {
        return Err(INVALID.into());
    }
    let relative = files
        .iter()
        .map(|path| {
            bin_rollout_relative(path, root).map(|path| path.to_string_lossy().into_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let row = manifest
        .state_backup
        .as_ref()
        .and_then(|backup| backup.thread.as_ref());
    if !rollout_pointer::validate(
        &manifest.relative_rollout_path,
        row,
        relative.iter().map(String::as_str),
    ) {
        return Err(INVALID.into());
    }
    for path in files {
        if first_rollout_value(path)?
            .as_ref()
            .and_then(snapshot_id)
            .as_ref()
            != Some(&manifest.session_id)
        {
            return Err(INVALID.into());
        }
    }
    Ok(())
}

pub(super) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(INVALID.into());
    }
    Ok(())
}

fn validate_manifests(items: &[BinManifest]) -> Result<(), String> {
    let mut ids = HashSet::new();
    if items.is_empty() {
        return Err(INVALID.into());
    }
    for item in items {
        validate_id(&item.session_id)?;
        if !ids.insert(&item.session_id) {
            return Err(INVALID.into());
        }
        let relative =
            safe_relative_path(&item.relative_rollout_path).ok_or_else(|| INVALID.to_owned())?;
        if !ROLLOUT_FOLDERS
            .iter()
            .any(|folder| relative.starts_with(folder))
            || logical_rollout_path(&relative).is_none()
            || !rollout_pointer::matches(
                &item.relative_rollout_path,
                &item.original_rollout_path.to_string_lossy(),
            )
        {
            return Err(INVALID.into());
        }
        if let Some(state) = &item.state_backup {
            if state
                .thread
                .as_ref()
                .is_some_and(|row| sqlite_row_text(row, "id") != Some(&item.session_id))
            {
                return Err(INVALID.into());
            }
            for table in &state.tables {
                for row in &table.rows {
                    let columns = if table.table == "thread_spawn_edges" {
                        vec!["parent_thread_id", "child_thread_id"]
                    } else {
                        vec!["thread_id"]
                    };
                    if !columns
                        .iter()
                        .any(|column| sqlite_row_text(row, column) == Some(&item.session_id))
                    {
                        return Err(INVALID.into());
                    }
                }
            }
        }
    }
    Ok(())
}
