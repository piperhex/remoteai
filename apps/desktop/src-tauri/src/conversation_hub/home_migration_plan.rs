use super::home_migration_error::{MigrationFailure, MigrationStage};
use super::*;

/// A migration includes connected, available sessions so hidden descendants do
/// not force users to find and select every thread by hand.
pub(super) fn plan_home_migration(
    source: &Path,
    target: &Path,
    requested: &HashSet<String>,
) -> Result<Vec<RolloutSnapshot>, MigrationFailure> {
    let read_source = |error| MigrationFailure::new(MigrationStage::ReadSource, error);
    let read_target = |error| MigrationFailure::new(MigrationStage::ReadDestination, error);
    let all = merge_bin_snapshots(gather_snapshots(source).map_err(read_source)?);
    let edges = super::thread_relations::edges(source, &all).map_err(read_source)?;
    let selected = connected_sessions(&all, &edges, requested);
    let existing = target_session_ids(target).map_err(read_target)?;
    let target_history = live_bin_thread_ids(target).map_err(read_target)?;
    let mut moving = HashSet::new();
    for item in &all {
        if selected.contains(&item.session_id)
            && !existing.contains(&item.session_id)
            && !has_target_path(item, source, target).map_err(read_target)?
        {
            moving.insert(item.session_id.clone());
        }
    }
    retain_required_source_history(&all, &mut moving);
    for item in all.iter().filter(|item| moving.contains(&item.session_id)) {
        if let Some(base) = &item.history_base_thread_id {
            if !moving.contains(base) && !target_history.contains(base) {
                return Err(MigrationFailure::new(
                    MigrationStage::ReadSource,
                    format!("required conversation history is missing: {base}"),
                )
                .for_session(&item.session_id));
            }
        }
    }
    let mut planned = all
        .into_iter()
        .filter(|item| moving.contains(&item.session_id))
        .collect::<Vec<_>>();
    planned.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    Ok(planned)
}

pub(super) fn target_session_ids(home: &Path) -> Result<HashSet<String>, String> {
    let mut ids = live_bin_thread_ids(home)?;
    if let Some(path) = latest_state_db(home) {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT id FROM threads")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        ids.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(ids)
}

fn has_target_path(item: &RolloutSnapshot, source: &Path, target: &Path) -> Result<bool, String> {
    for path in &item.physical_paths {
        if target.join(bin_rollout_relative(path, source)?).exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn connected_sessions(
    all: &[RolloutSnapshot],
    edges: &[(String, String)],
    requested: &HashSet<String>,
) -> HashSet<String> {
    let available = all
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<HashSet<_>>();
    let mut selected = requested
        .intersection(&available)
        .cloned()
        .collect::<HashSet<_>>();
    loop {
        let previous = selected.len();
        for (parent, child) in edges {
            if available.contains(parent)
                && available.contains(child)
                && (selected.contains(parent) || selected.contains(child))
            {
                selected.extend([parent.clone(), child.clone()]);
            }
        }
        if selected.len() == previous {
            return selected;
        }
    }
}

pub(super) fn retain_required_source_history(
    all: &[RolloutSnapshot],
    moving: &mut HashSet<String>,
) {
    loop {
        let required = all
            .iter()
            .filter(|item| !moving.contains(&item.session_id))
            .flat_map(|item| [&item.history_base_thread_id, &item.parent_thread_id])
            .flatten()
            .cloned()
            .collect::<HashSet<_>>();
        let previous = moving.len();
        moving.retain(|id| !required.contains(id));
        if previous == moving.len() {
            return;
        }
    }
}
