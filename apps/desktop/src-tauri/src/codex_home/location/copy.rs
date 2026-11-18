use rusqlite::{Connection, DatabaseName, OpenFlags};
use std::{
    fs, io,
    io::Read,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const RECEIPT: &str = ".remoteai-home-copy";

pub(super) fn published(target: &Path, id: Uuid) -> bool {
    let receipt = target.join(RECEIPT);
    let expected = id.to_string();
    fs::symlink_metadata(&receipt).is_ok_and(|m| m.is_file() && m.len() == expected.len() as u64)
        && fs::read_to_string(receipt).is_ok_and(|value| value == expected)
}

pub(super) fn install(source: &Path, target: &Path, id: Uuid) -> Result<(), String> {
    stage_and_publish(source, target, id).map_err(|error| {
        eprintln!("Agent Hub home copy failed: {error}");
        super::FAILED.to_owned()
    })
}

fn stage_and_publish(source: &Path, target: &Path, id: Uuid) -> io::Result<()> {
    let parent = target.parent().ok_or(io::ErrorKind::InvalidInput)?;
    let staging = tempfile::Builder::new()
        .prefix(".remoteai-home-")
        .tempdir_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(staging.path(), fs::Permissions::from_mode(0o700))?;
    }
    let canonical = source.canonicalize()?;
    let plain = crate::codex_gui::execution_path(&canonical);
    let roots = CopyRoots {
        source,
        target,
        canonical: &canonical,
        plain: Path::new(&plain),
    };
    copy_directory(&roots, source, staging.path())?;
    relocate_rollouts(staging.path(), &roots)?;
    fs::write(staging.path().join(RECEIPT), id.to_string())?;
    // remove_dir succeeds only for an empty destination. Never replace user files.
    fs::remove_dir(target)?;
    if let Err(error) = fs::rename(staging.path(), target) {
        fs::create_dir_all(target)?;
        return Err(error);
    }
    Ok(())
}

struct CopyRoots<'a> {
    source: &'a Path,
    target: &'a Path,
    canonical: &'a Path,
    plain: &'a Path,
}

impl CopyRoots<'_> {
    fn relocate(&self, path: &Path) -> Option<PathBuf> {
        let relative = path
            .strip_prefix(self.source)
            .or_else(|_| path.strip_prefix(self.canonical))
            .or_else(|_| path.strip_prefix(self.plain))
            .ok()?;
        Some(self.target.join(relative))
    }
}

fn copy_directory(roots: &CopyRoots<'_>, from: &Path, to: &Path) -> io::Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        // Process locks and CLI scratch executables are regenerated on startup.
        if from == roots.source
            && matches!(
                name.to_str(),
                Some("tmp" | ".tmp" | "thread-writer-locks" | RECEIPT)
            )
        {
            continue;
        }
        let source = entry.path();
        let destination = to.join(name);
        let kind = entry.file_type()?;
        if is_link(&source, kind)? {
            copy_link(roots, &source, &destination, kind)?;
        } else if kind.is_dir() {
            fs::create_dir(&destination)?;
            copy_directory(roots, &source, &destination)?;
        } else if kind.is_file() {
            copy_file(&source, &destination)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_link(path: &Path, _kind: fs::FileType) -> io::Result<bool> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    Ok(fs::symlink_metadata(path)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

#[cfg(not(windows))]
fn is_link(_path: &Path, kind: fs::FileType) -> io::Result<bool> {
    Ok(kind.is_symlink())
}

fn copy_file(from: &Path, to: &Path) -> io::Result<()> {
    let name = from
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let database = |name: &str| name.ends_with(".sqlite") || name.ends_with(".db");
    // SQLite's snapshot includes committed WAL frames but never reuses another database's journal.
    for suffix in ["-wal", "-shm", "-journal"] {
        if let Some(base) = name.strip_suffix(suffix).filter(|base| database(base)) {
            let db = from.with_file_name(base);
            if db.is_file() && sqlite_header(&db)? {
                return Ok(());
            }
        }
    }
    if database(name) && sqlite_header(from)? {
        let db = Connection::open_with_flags(from, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(io::Error::other)?;
        db.backup(DatabaseName::Main, to, None)
            .map_err(io::Error::other)?;
        fs::set_permissions(to, fs::metadata(from)?.permissions())?;
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

fn sqlite_header(path: &Path) -> io::Result<bool> {
    let mut header = [0; 16];
    match fs::File::open(path)?.read_exact(&mut header) {
        Ok(()) => Ok(header == *b"SQLite format 3\0"),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

fn copy_link(roots: &CopyRoots<'_>, from: &Path, to: &Path, _kind: fs::FileType) -> io::Result<()> {
    let link = fs::read_link(from)?;
    let target = roots.relocate(&link).unwrap_or(link);
    #[cfg(windows)]
    {
        use std::os::windows::fs::{symlink_dir, symlink_file, FileTypeExt};
        if _kind.is_symlink_dir() || _kind.is_dir() {
            symlink_dir(target, to)
        } else {
            symlink_file(target, to)
        }
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, to)
    }
}

// Copied thread indexes must resume the new rollout, even while the old folder still exists.
fn relocate_rollouts(staging: &Path, roots: &CopyRoots<'_>) -> io::Result<()> {
    for entry in fs::read_dir(staging)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type()?.is_file() && name.starts_with("state_") && name.ends_with(".sqlite") {
            rewrite_index(&entry.path(), roots).map_err(io::Error::other)?;
        }
    }
    Ok(())
}

fn rewrite_index(database: &Path, roots: &CopyRoots<'_>) -> rusqlite::Result<()> {
    let mut connection = Connection::open(database)?;
    let transaction = connection.transaction()?;
    let has_paths: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('threads') WHERE name='rollout_path')",
        [],
        |r| r.get(0),
    )?;
    if has_paths {
        let mut query = transaction
            .prepare("SELECT id, rollout_path FROM threads WHERE rollout_path IS NOT NULL")?;
        let rows = query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut update = transaction.prepare("UPDATE threads SET rollout_path=?1 WHERE id=?2")?;
        for (id, path) in rows {
            if let Some(next) = roots.relocate(Path::new(&path)) {
                update.execute(rusqlite::params![next.to_string_lossy(), id])?;
            }
        }
    }
    transaction.commit()
}
