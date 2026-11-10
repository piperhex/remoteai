use super::*;

const CHECKPOINT: &str = "transfer.json";

pub(super) fn prune(cache: &Path) -> Result<(), String> {
    if !cache.exists() {
        return Ok(());
    }
    for item in fs::read_dir(cache).map_err(|error| error.to_string())? {
        let item = item.map_err(|error| error.to_string())?;
        if !item
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
            || Uuid::parse_str(&item.file_name().to_string_lossy()).is_err()
        {
            continue;
        }
        let root = item.path();
        let checkpoint = root.join(CHECKPOINT);
        let path = if checkpoint.exists() {
            checkpoint
        } else {
            root.clone()
        };
        let expired = fs::metadata(path)
            .and_then(|meta| meta.modified())
            .and_then(|time| time.elapsed().map_err(std::io::Error::other))
            .map_err(|error| error.to_string())?
            >= TRANSFER_TTL;
        if !expired {
            continue;
        }
        let retained = fs::read(root.join(CHECKPOINT))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|value| value["retain"] == true);
        if !retained {
            fs::remove_dir_all(root).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn save(entry: &Transfer) -> Result<(), String> {
    if entry.resume_token.is_empty() {
        return Ok(());
    }
    let temporary = entry.root.join("transfer.pending.json");
    let mut file = File::create(&temporary).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, entry).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    // Windows cannot rename over an existing file. A pending checkpoint is recoverable
    // if the process exits between removal and rename.
    let path = entry.root.join(CHECKPOINT);
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

pub(super) fn description(id: &str, entry: &Transfer) -> Result<Value, String> {
    let session_ids = if entry.root.join("manifest.json").exists() {
        archive::snapshots(&entry.root)?
            .into_iter()
            .map(|item| item.manifest.session_id)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    Ok(
        json!({ "id": id, "size": entry.size, "sha256": entry.sha256,
        "originalSize": entry.original_size, "resumeToken": entry.resume_token,
        "written": entry.written, "chunkBytes": CHUNK_BYTES, "sessionIds": session_ids }),
    )
}

pub(super) fn load(root: &Path, token: &str) -> Result<Transfer, String> {
    if Uuid::parse_str(token).is_err() {
        return Err(INVALID.into());
    }
    let path = root.join(CHECKPOINT);
    let path = if path.exists() {
        path
    } else {
        root.join("transfer.pending.json")
    };
    let modified = fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .map_err(|_| INVALID.to_owned())?;
    if modified.elapsed().map_err(|_| INVALID.to_owned())? >= TRANSFER_TTL {
        return Err(INVALID.into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let mut entry: Transfer = serde_json::from_slice(&bytes).map_err(|_| INVALID.to_owned())?;
    if entry.resume_token != token || entry.root != root {
        return Err(INVALID.into());
    }
    let size = fs::metadata(root.join("bundle.zip"))
        .map_err(|error| error.to_string())?
        .len();
    if size < entry.written || entry.written > entry.size {
        return Err(INVALID.into());
    }
    // Unacknowledged tail bytes may have reached disk just before a process exit.
    File::options()
        .write(true)
        .open(root.join("bundle.zip"))
        .and_then(|file| file.set_len(entry.written))
        .map_err(|error| error.to_string())?;
    entry.touched = Instant::now();
    Ok(entry)
}

pub(super) fn resume<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    token: &str,
) -> Result<Value, String> {
    if Uuid::parse_str(id).is_err() || Uuid::parse_str(token).is_err() {
        return Err(INVALID.into());
    }
    let mut transfers = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    if !transfers.contains_key(id) {
        if transfers.len() >= MAX_TRANSFERS {
            return Err(INVALID.into());
        }
        let root = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("conversation-sync")
            .join(id);
        let entry = load(&root, token)?;
        transfers.insert(id.to_owned(), entry);
    }
    let entry = transfers.get_mut(id).ok_or(INVALID)?;
    if entry.resume_token != token || entry.touched.elapsed() >= TRANSFER_TTL {
        return Err(INVALID.into());
    }
    entry.touched = Instant::now();
    save(entry)?;
    description(id, entry)
}
