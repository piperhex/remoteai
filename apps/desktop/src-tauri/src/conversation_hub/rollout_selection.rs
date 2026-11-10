use super::*;

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
) -> &'a PathBuf {
    let Some(indexed) = row.and_then(|row| sqlite_row_text(row, "rollout_path")) else {
        return &snapshot.path;
    };
    let indexed = Path::new(indexed);
    let Some(logical) = logical_rollout_path(indexed) else {
        return &snapshot.path;
    };
    let indexed_identity = identity(indexed);
    snapshot
        .physical_paths
        .iter()
        .find(|source| {
            logical_rollout_path(source).as_ref() == Some(&logical)
                || indexed_identity
                    .as_ref()
                    .is_some_and(|indexed| identity(source).as_ref() == Some(indexed))
        })
        .unwrap_or(&snapshot.path)
}
