use super::{Change, Result, UndoError, MAX_EDIT_BYTES};
use std::{collections::BTreeMap, fs, io::Write, path::Path, process::Stdio};

type Snapshot = BTreeMap<String, Option<Vec<u8>>>;

fn read(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_EDIT_BYTES as u64 => {
            Err(UndoError::Invalid)
        }
        Ok(_) => fs::read(path).map(Some).map_err(|_| UndoError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(UndoError::Io),
    }
}

fn write(path: &Path, bytes: Option<&[u8]>) -> Result<()> {
    if let Some(bytes) = bytes {
        fs::create_dir_all(path.parent().ok_or(UndoError::Invalid)?).map_err(|_| UndoError::Io)?;
        replace_file(path, bytes)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(UndoError::Io),
        }
    }
}

fn replace_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_file_name(format!(".codex-undo-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(path) {
            file.set_permissions(metadata.permissions())?;
        }
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() && temporary.exists() && fs::remove_file(&temporary).is_err() {
        eprintln!("Could not remove an edit undo temporary file");
    }
    result.map_err(|_| UndoError::Io)
}

fn patch_hunks(staging: &Path, edit: &Change) -> Result<String> {
    let offset = edit.diff.find("@@ ").ok_or(UndoError::Invalid)?;
    let hunks = &edit.diff[offset..];
    let target = staging.join(edit.kind.move_path.as_ref().unwrap_or(&edit.path));
    let bytes = read(&target)?.ok_or(UndoError::Conflict)?;
    let crlf = bytes.contains(&b'\n')
        && bytes
            .iter()
            .enumerate()
            .filter(|(_, byte)| **byte == b'\n')
            .all(|(index, _)| index > 0 && bytes[index - 1] == b'\r');
    // Hunk metadata stays LF; match and restore file content with its existing Windows line endings.
    let hunks: String = hunks
        .split_inclusive('\n')
        .map(|line| {
            if crlf
                && line.starts_with(['+', '-', ' '])
                && line.ends_with('\n')
                && !line.ends_with("\r\n")
            {
                format!("{}\r\n", &line[..line.len() - 1])
            } else {
                line.to_owned()
            }
        })
        .collect();
    verify_after_image(&bytes, &hunks)?;
    Ok(hunks)
}

// git apply can relocate an otherwise matching hunk into another writer's identical text.
fn verify_after_image(content: &[u8], hunks: &str) -> Result<()> {
    let lines: Vec<_> = content.split_inclusive(|byte| *byte == b'\n').collect();
    let mut patch = hunks.split_inclusive('\n').peekable();
    let mut index = 0;
    while let Some(line) = patch.next() {
        if line.starts_with("@@ ") {
            let range = line
                .split_ascii_whitespace()
                .nth(2)
                .and_then(|field| field.strip_prefix('+'))
                .ok_or(UndoError::Invalid)?;
            let (start, count) = range.split_once(',').unwrap_or((range, "1"));
            if count == "0" {
                return Err(UndoError::Conflict);
            }
            index = start
                .parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1))
                .ok_or(UndoError::Invalid)?;
        } else if line.starts_with(['+', ' ']) {
            let mut expected = &line[1..];
            if patch.peek().is_some_and(|next| next.starts_with("\\ ")) {
                expected = expected
                    .trim_end_matches('\n')
                    .strip_suffix('\r')
                    .unwrap_or(expected.trim_end_matches('\n'));
            }
            if lines.get(index).copied() != Some(expected.as_bytes()) {
                return Err(UndoError::Conflict);
            }
            index += 1;
        }
    }
    Ok(())
}

fn capture(root: &Path, edits: &[Change]) -> Result<Snapshot> {
    let mut snapshot = Snapshot::new();
    let mut bytes = 0;
    for path in edits
        .iter()
        .flat_map(|edit| std::iter::once(&edit.path).chain(edit.kind.move_path.iter()))
    {
        if snapshot.contains_key(path) {
            continue;
        }
        let content = read(&root.join(path))?;
        bytes += content.as_ref().map_or(0, Vec::len);
        if bytes > MAX_EDIT_BYTES {
            return Err(UndoError::Invalid);
        }
        snapshot.insert(path.clone(), content);
    }
    Ok(snapshot)
}

fn reverse_update(staging: &Path, edit: &Change) -> Result<()> {
    let destination = edit.kind.move_path.as_ref().unwrap_or(&edit.path);
    let old = serde_json::to_string(&format!("a/{}", edit.path)).map_err(|_| UndoError::Invalid)?;
    let new = serde_json::to_string(&format!("b/{destination}")).map_err(|_| UndoError::Invalid)?;
    let patch = format!(
        "diff --git {old} {new}\n--- {old}\n+++ {new}\n{}",
        patch_hunks(staging, edit)?
    );
    let mut command = crate::codex_gui::git::command(staging);
    // Stage outside the repository; Git validates paths and rejects conflicting hunks atomically.
    command
        .args([
            "-c",
            "core.autocrlf=false",
            "apply",
            "--no-index",
            "--reverse",
            "--unidiff-zero",
            "--whitespace=nowarn",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| UndoError::Git)?;
    let input = child
        .stdin
        .take()
        .ok_or(UndoError::Io)?
        .write_all(patch.as_bytes());
    let output = child.wait().map_err(|_| UndoError::Io)?;
    if input.is_err() || !output.success() {
        return Err(UndoError::Conflict);
    }
    Ok(())
}

fn reverse(staging: &Path, edit: &Change) -> Result<()> {
    let target = staging.join(edit.kind.move_path.as_ref().unwrap_or(&edit.path));
    match edit.kind.kind.as_str() {
        "add" => {
            let content = read(&target)?.ok_or(UndoError::Conflict)?;
            if content != edit.diff.as_bytes() {
                return Err(UndoError::Conflict);
            }
            write(&target, None)
        }
        "delete" => {
            if target.exists() {
                return Err(UndoError::Conflict);
            }
            write(&target, Some(edit.diff.as_bytes()))
        }
        // An empty rename record has no content witness for the file now at the destination.
        "update" if edit.kind.move_path.is_some() && edit.diff.is_empty() => {
            Err(UndoError::Conflict)
        }
        "update" => reverse_update(staging, edit),
        _ => Err(UndoError::Invalid),
    }
}

fn apply(root: &Path, before: &Snapshot, after: &Snapshot) -> Result<()> {
    // Check again after preparation so intervening edits cannot be silently overwritten.
    for (path, bytes) in before {
        super::relative_path(root, path)?;
        if read(&root.join(path))? != *bytes {
            return Err(UndoError::Conflict);
        }
    }
    let mut written: Vec<&String> = Vec::new();
    for (path, bytes) in after {
        if before[path] == *bytes {
            continue;
        }
        let target = root.join(path);
        let result = read(&target).and_then(|current| {
            if current != before[path] {
                return Err(UndoError::Conflict);
            }
            write(&target, bytes.as_deref())
        });
        if result.is_ok() {
            written.push(path);
            continue;
        }
        let mut recovered = true;
        for path in written.into_iter().rev() {
            let target = root.join(path);
            if !matches!(read(&target), Ok(value) if value == after[path])
                || write(&target, before[path].as_deref()).is_err()
            {
                recovered = false;
            }
        }
        return if recovered {
            result
        } else {
            Err(UndoError::Recovery)
        };
    }
    Ok(())
}

fn prepare(staging: &Path, edits: &[Change], before: &Snapshot) -> Result<Snapshot> {
    let workspace = staging.join("workspace");
    fs::create_dir(&workspace).map_err(|_| UndoError::Io)?;
    for (path, bytes) in before {
        write(&workspace.join(path), bytes.as_deref())?;
    }
    for edit in edits.iter().rev() {
        reverse(&workspace, edit)?;
    }
    capture(&workspace, edits)
}

fn snapshot_version(before: &Snapshot) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(before).map_err(|_| UndoError::Io)?)
    ))
}

pub(super) fn preview(root: &Path, staging: &Path, edits: &[Change]) -> Result<(String, bool)> {
    let before = capture(root, edits)?;
    let version = snapshot_version(&before)?;
    match prepare(staging, edits, &before) {
        Ok(_) => Ok((version, false)),
        Err(UndoError::Conflict) => Ok((version, true)),
        Err(error) => Err(error),
    }
}

pub(super) fn prepare_and_apply(
    root: &Path,
    staging: &Path,
    edits: &[Change],
    expected: Option<&str>,
) -> Result<()> {
    let before = capture(root, edits)?;
    if let Some(expected) = expected {
        if snapshot_version(&before)? != expected {
            return Err(UndoError::Conflict);
        }
    }
    // Backups remain available when an OS error prevents a complete recovery.
    fs::write(
        staging.join("before.json"),
        serde_json::to_vec(&before).map_err(|_| UndoError::Io)?,
    )
    .map_err(|_| UndoError::Io)?;
    let after = prepare(staging, edits, &before)?;
    let marker = staging.join("completed");
    fs::write(&marker, b"undone").map_err(|_| UndoError::Io)?;
    apply(root, &before, &after)?;
    let receipt = staging
        .parent()
        .ok_or(UndoError::Invalid)?
        .join("completed");
    if fs::rename(marker, receipt).is_err() {
        apply(root, &after, &before).map_err(|_| UndoError::Recovery)?;
        return Err(UndoError::Io);
    }
    Ok(())
}
