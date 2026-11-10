use super::*;

const COPY_BUFFER_BYTES: usize = 64 * 1024;
const SHA256_HEX_LENGTH: usize = 64;
const MAX_SESSION_ID_LENGTH: usize = 128;

pub(super) fn write(
    home: &Path,
    snapshots: &[RolloutSnapshot],
    destination: &Path,
) -> Result<(), String> {
    if destination.as_os_str().is_empty() {
        return Err("请选择导出位置".to_string());
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| format!("无法创建导出目录：{error}"))?;
    let temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    let file = temporary.reopen().map_err(|error| error.to_string())?;
    let mut archive = ZipWriter::new(file);
    let included = ensure_export_dependencies(snapshots)?;
    let sessions = snapshots
        .iter()
        .map(|snapshot| write_session(home, snapshot, &mut archive, &included))
        .collect::<Result<Vec<_>, _>>()?;
    let manifest = PackageManifest {
        kind: BUNDLE_KIND.to_owned(),
        package_version: BUNDLE_REVISION,
        exported_at: Utc::now().to_rfc3339(),
        sessions,
    };
    validate(&manifest)?;
    archive
        .start_file("manifest.json", SimpleFileOptions::default())
        .map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut archive, &manifest).map_err(|error| error.to_string())?;
    archive
        .finish()
        .map_err(|error| error.to_string())?
        .sync_all()
        .map_err(|error| error.to_string())?;
    // Release Windows file handles before replacing the destination.
    let temporary = temporary.into_temp_path();
    replace_file(&temporary, destination).map_err(|error| format!("无法保存会话包：{error}"))
}

fn write_session(
    home: &Path,
    snapshot: &RolloutSnapshot,
    archive: &mut ZipWriter<File>,
    included: &HashSet<String>,
) -> Result<PackageItem, String> {
    let row = snapshot_thread_row(latest_state_db(home).as_deref(), &snapshot.session_id)?;
    let current = bin_rollout_relative(rollout_selection::primary(snapshot, row.as_ref()), home)?;
    let rollouts = snapshot
        .physical_paths
        .iter()
        .map(|path| write_rollout(home, path, &snapshot.session_id, archive))
        .collect::<Result<Vec<_>, _>>()?;
    let primary = rollouts
        .iter()
        .find(|file| safe_relative_path(&file.relative_rollout_path).as_ref() == Some(&current))
        .ok_or(synchronization::INVALID)?;
    Ok(PackageItem {
        session_id: snapshot.session_id.clone(),
        title: snapshot.title.clone(),
        cwd: snapshot.cwd.clone(),
        updated_at: snapshot.updated_at,
        relative_rollout_path: primary.relative_rollout_path.clone(),
        file_entry: primary.file_entry.clone(),
        size_bytes: rollouts.iter().map(|file| file.size_bytes).sum(),
        sha256: primary.sha256.clone(),
        session_index_entry: snapshot.index_value.clone(),
        source_instance: Some(json!({ "id": "__default__", "name": "默认实例" })),
        state_row: row,
        related_state: snapshot_related_state(home, &snapshot.session_id, included)?,
        rollouts,
    })
}

fn write_rollout(
    home: &Path,
    path: &Path,
    id: &str,
    archive: &mut ZipWriter<File>,
) -> Result<PackageRollout, String> {
    let relative = bin_rollout_relative(path, home)?
        .to_string_lossy()
        .replace('\\', "/");
    let file_entry = format!("files/{}/{relative}", safe_name(id));
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    archive
        .start_file(
            &file_entry,
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut size_bytes = 0;
    let mut buffer = [0; COPY_BUFFER_BYTES];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        archive
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        digest.update(&buffer[..count]);
        size_bytes += count as u64;
    }
    Ok(PackageRollout {
        relative_rollout_path: relative,
        file_entry,
        size_bytes,
        sha256: format!("{:x}", digest.finalize()),
    })
}

pub(super) fn files(item: &PackageItem) -> Vec<PackageRollout> {
    if !item.rollouts.is_empty() {
        return item.rollouts.clone();
    }
    // Version 1 stores a single physical file directly on the session entry.
    vec![PackageRollout {
        relative_rollout_path: item.relative_rollout_path.clone(),
        file_entry: item.file_entry.clone(),
        size_bytes: item.size_bytes,
        sha256: item.sha256.clone(),
    }]
}

pub(super) fn relative(value: &str) -> Result<PathBuf, String> {
    safe_relative_path(value)
        .filter(|path| {
            ROLLOUT_FOLDERS
                .iter()
                .any(|folder| path.starts_with(folder))
        })
        .filter(|path| logical_rollout_path(path).is_some())
        .ok_or_else(|| synchronization::INVALID.to_owned())
}

pub(super) fn validate(manifest: &PackageManifest) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    let mut entries = HashSet::new();
    for item in &manifest.sessions {
        if item.session_id.is_empty()
            || item.session_id.len() > MAX_SESSION_ID_LENGTH
            || !item
                .session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            || !ids.insert(&item.session_id)
        {
            return Err(synchronization::INVALID.into());
        }
        validate_session(item, manifest.package_version)?;
        for file in files(item) {
            if !paths.insert(relative(&file.relative_rollout_path)?)
                || !entries.insert(file.file_entry.clone())
                || safe_relative_path(&file.file_entry).is_none()
                || file.sha256.len() != SHA256_HEX_LENGTH
                || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(synchronization::INVALID.into());
            }
        }
    }
    Ok(())
}

fn validate_session(item: &PackageItem, version: u32) -> Result<(), String> {
    let primary = relative(&item.relative_rollout_path)?;
    if version == 1 && item.rollouts.is_empty() {
        return Ok(());
    }
    let total = item
        .rollouts
        .iter()
        .try_fold(0u64, |total, file| total.checked_add(file.size_bytes));
    if total != Some(item.size_bytes)
        || !item.rollouts.iter().any(|file| {
            relative(&file.relative_rollout_path).ok().as_ref() == Some(&primary)
                && file.file_entry == item.file_entry
                && file.sha256 == item.sha256
        })
    {
        return Err(synchronization::INVALID.into());
    }
    Ok(())
}
