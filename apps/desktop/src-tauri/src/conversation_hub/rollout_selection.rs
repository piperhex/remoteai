use super::*;

#[derive(Debug, thiserror::Error)]
#[error("current rollout cannot be verified for conversation {session_id}")]
pub(super) struct SelectionError {
    session_id: String,
}

impl SelectionError {
    pub(super) fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_owned(),
        }
    }
}

impl From<SelectionError> for String {
    fn from(error: SelectionError) -> Self {
        json!({
            "code": "client.errorsConversations.sessionFailedVerification",
            "params": { "value1": error.session_id },
        })
        .to_string()
    }
}

/// Keep the database's current rollout even when Windows stores its extended path spelling.
/// Resolve a physical file before removing the compression suffix: the logical .jsonl may
/// no longer exist after compression, so canonicalizing only that logical path is insufficient.
fn identity(path: &Path) -> Option<PathBuf> {
    let logical = logical_rollout_path(path)?;
    let physical = preferred_rollout_path(&logical)?;
    logical_rollout_path(&fs::canonicalize(physical).ok()?)
}

pub(super) fn primary<'a>(
    snapshot: &'a RolloutSnapshot,
    row: Option<&SqliteRowSnapshot>,
) -> Result<&'a PathBuf, SelectionError> {
    let error = || SelectionError::new(&snapshot.session_id);
    let Some(row) = row else {
        // A compressed shadow is the same logical record. Distinct segments cannot be
        // ordered by filename or modification time to reconstruct a missing index.
        let logical = snapshot
            .physical_paths
            .iter()
            .map(|path| logical_rollout_path(path))
            .collect::<Option<HashSet<_>>>()
            .ok_or_else(error)?;
        if logical.len() != 1 {
            return Err(error());
        }
        return snapshot
            .physical_paths
            .iter()
            .find(|path| *path == &snapshot.path && path.is_file())
            .ok_or_else(error);
    };
    let indexed = Path::new(sqlite_row_text(row, "rollout_path").ok_or_else(error)?);
    let logical = logical_rollout_path(indexed).ok_or_else(error)?;
    let indexed_identity = identity(indexed);
    snapshot
        .physical_paths
        .iter()
        .find(|source| {
            source.is_file()
                && (logical_rollout_path(source).as_ref() == Some(&logical)
                    || indexed_identity
                        .as_ref()
                        .is_some_and(|indexed| identity(source).as_ref() == Some(indexed)))
        })
        .ok_or_else(error)
}
