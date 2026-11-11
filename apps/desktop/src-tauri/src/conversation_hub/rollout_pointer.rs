//! Validate recorded pointers without consulting the exporting computer's filesystem.
use super::*;

fn logical(value: &str) -> Option<String> {
    let normalized = value.replace('\\', "/");
    let normalized = normalized.strip_suffix(".zst").unwrap_or(&normalized);
    let name = normalized.rsplit('/').next()?;
    (name.starts_with("rollout-") && name.ends_with(".jsonl")).then(|| normalized.to_owned())
}

pub(super) fn matches(current: &str, indexed: &str) -> bool {
    let Some(current) = logical(current) else {
        return false;
    };
    let Some(indexed) = logical(indexed) else {
        return false;
    };
    // Source paths can be Windows paths even when the receiver is macOS or Linux.
    // Keep Unix paths case-sensitive; compare complete components, never just filenames.
    let windows = indexed.starts_with("//") || indexed.as_bytes().get(1) == Some(&b':');
    let (current, indexed) = if windows {
        (current.to_ascii_lowercase(), indexed.to_ascii_lowercase())
    } else {
        (current, indexed)
    };
    indexed == current || indexed.ends_with(&format!("/{current}"))
}

pub(super) fn validate<'a>(
    current: &str,
    row: Option<&SqliteRowSnapshot>,
    files: impl Iterator<Item = &'a str>,
) -> bool {
    if let Some(row) = row {
        return sqlite_row_text(row, "rollout_path")
            .is_some_and(|indexed| matches(current, indexed));
    }
    // Old unindexed single-file exports remain usable, including their compressed shadows.
    // A multi-segment package without an independent current pointer is ambiguous.
    files
        .map(logical)
        .collect::<Option<HashSet<_>>>()
        .is_some_and(|paths| paths.len() == 1)
}
