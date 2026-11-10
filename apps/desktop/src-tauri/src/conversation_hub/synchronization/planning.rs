use super::super::home_migration_provider::{MigrationDestination, MigrationModelProvider};
use super::*;

#[derive(Serialize, Deserialize)]
pub(super) struct Plan {
    ids: HashSet<String>,
    duplicates: HashSet<String>,
    fingerprints: HashMap<String, String>,
    pub(super) result: Option<Value>,
}

fn fingerprints(target: &Path, ids: &HashSet<String>) -> Result<HashMap<String, String>, String> {
    let all = merge_bin_snapshots(gather_snapshots(target)?)
        .into_iter()
        .map(|item| (item.session_id.clone(), item))
        .collect::<HashMap<_, _>>();
    let index = index_values(target)?;
    ids.iter()
        .map(|id| Ok((id.clone(), fingerprint(target, id, &all, &index)?)))
        .collect()
}

fn fingerprint(
    target: &Path,
    id: &str,
    all: &HashMap<String, RolloutSnapshot>,
    index: &HashMap<String, Value>,
) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&snapshot_bin_state(target, id)?).map_err(|e| e.to_string())?);
    hash.update(serde_json::to_vec(&index.get(id)).map_err(|e| e.to_string())?);
    let mut paths = all
        .get(id)
        .map(|item| item.physical_paths.clone())
        .unwrap_or_default();
    paths.sort();
    paths.dedup();
    for path in paths {
        hash.update(path.to_string_lossy().as_bytes());
        hash.update(sha256(&path)?);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn preview<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &mut Transfer,
    session_ids: Option<Vec<String>>,
) -> Result<Value, String> {
    let target =
        crate::codex_home::resolve_selected(app, Some(crate::codex_home::GUI_CODEX_HOME_ID))?;
    match session_ids {
        Some(ids) => preview_ids(&target, entry, normalized_ids(ids)),
        None => preview_at_target(&target, entry),
    }
}

pub(super) fn preview_at_target(target: &Path, entry: &mut Transfer) -> Result<Value, String> {
    if entry.source.is_none() && !entry.root.join("manifest.json").exists() {
        archive::unpack(entry)?;
    }
    let ids = archive::snapshots(&entry.root)?
        .into_iter()
        .map(|item| item.manifest.session_id)
        .collect();
    preview_ids(target, entry, ids)
}

pub(super) fn preview_ids(
    target: &Path,
    entry: &mut Transfer,
    ids: HashSet<String>,
) -> Result<Value, String> {
    if ids.is_empty() {
        return Err(INVALID.into());
    }
    for id in &ids {
        archive::validate_id(id)?;
    }
    if let Some(source) = &entry.source {
        if fs::canonicalize(source).map_err(|e| e.to_string())?
            == fs::canonicalize(target).map_err(|e| e.to_string())?
        {
            return Err(INVALID.into());
        }
    }
    let _guard = bin_operation_guard()?;
    let existing = super::super::home_migration_plan::target_session_ids(target)?;
    let duplicates = ids.intersection(&existing).cloned().collect::<HashSet<_>>();
    let fingerprints = fingerprints(target, &ids)?;
    let result = json!({ "count": ids.len(), "duplicateIds": duplicates });
    entry.plan = Some(Plan {
        ids,
        duplicates,
        fingerprints,
        result: None,
    });
    Ok(result)
}

pub(super) fn commit<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entry: &mut Transfer,
    overwrites: Vec<String>,
    provider: MigrationModelProvider,
) -> Result<Value, String> {
    let target =
        crate::codex_home::resolve_selected(app, Some(crate::codex_home::GUI_CODEX_HOME_ID))?;
    commit_at_target(&target, entry, overwrites, provider)
}

pub(super) fn commit_at_target(
    target: &Path,
    entry: &mut Transfer,
    overwrites: Vec<String>,
    provider: MigrationModelProvider,
) -> Result<Value, String> {
    let plan = entry.plan.as_ref().ok_or_else(|| INVALID.to_owned())?;
    if let Some(result) = &plan.result {
        return Ok(result.clone());
    }
    let overwrites = normalized_ids(overwrites);
    if !overwrites.is_subset(&plan.duplicates) {
        return Err(INVALID.into());
    }
    let _guard = bin_operation_guard()?;
    if fingerprints(target, &plan.ids)? != plan.fingerprints {
        return Err(CHANGED.into());
    }
    let snapshots = selected_snapshots(target, entry, plan, &overwrites)?;
    let requested = plan.ids.len();
    let count = apply_transfer(target, entry, provider, snapshots)?;
    let result = json!({ "completedCount": count, "skippedCount": requested - count });
    if let Some(plan) = &mut entry.plan {
        plan.result = Some(result.clone());
    }
    Ok(result)
}

fn apply_transfer(
    target: &Path,
    entry: &mut Transfer,
    provider: MigrationModelProvider,
    snapshots: Vec<BinSnapshot>,
) -> Result<usize, String> {
    let count = snapshots.len();
    let result = super::super::home_migration_batch::synchronize_batch(
        entry.source.as_deref(),
        MigrationDestination {
            path: target,
            model_provider: Some(provider),
        },
        &entry.root,
        snapshots,
    );
    if let Err(error) = result {
        entry.retain = matches!(
            error.recovery,
            super::super::home_migration_error::MigrationRecovery::Incomplete
        );
        return Err(error.diagnostic());
    }
    Ok(count)
}

fn selected_snapshots(
    target: &Path,
    entry: &Transfer,
    plan: &Plan,
    overwrites: &HashSet<String>,
) -> Result<Vec<BinSnapshot>, String> {
    if overwrites.is_empty() && plan.ids == plan.duplicates {
        return Ok(Vec::new());
    }
    if entry.source.is_none() && !entry.root.join("manifest.json").exists() {
        archive::unpack(entry)?;
    }
    let mut snapshots = archive::snapshots(&entry.root)?;
    let ids = snapshots
        .iter()
        .map(|item| item.manifest.session_id.clone())
        .collect::<HashSet<_>>();
    if ids != plan.ids {
        return Err(INVALID.into());
    }
    snapshots.retain(|item| {
        !plan.duplicates.contains(&item.manifest.session_id)
            || overwrites.contains(&item.manifest.session_id)
    });
    if let Some(source) = &entry.source {
        let all = merge_bin_snapshots(gather_snapshots(source)?);
        let mut moving = snapshots
            .iter()
            .map(|item| item.manifest.session_id.clone())
            .collect();
        super::super::home_migration_plan::retain_required_source_history(&all, &mut moving);
        snapshots.retain(|item| moving.contains(&item.manifest.session_id));
    }
    validate_history(target, &snapshots)?;
    validate_destination(target, &snapshots)?;
    Ok(snapshots)
}

fn validate_history(target: &Path, snapshots: &[BinSnapshot]) -> Result<(), String> {
    // A skipped base must still have usable history at the destination.
    let available = live_bin_thread_ids(target)?
        .into_iter()
        .chain(
            snapshots
                .iter()
                .map(|item| item.manifest.session_id.clone()),
        )
        .collect::<HashSet<_>>();
    for item in snapshots {
        for path in &item.rollouts {
            if first_rollout_value(path)?
                .as_ref()
                .and_then(|meta| snapshot_reference_id(meta, "history_base"))
                .is_some_and(|id| !available.contains(&id))
            {
                return Err(INVALID.into());
            }
        }
    }
    Ok(())
}

fn validate_destination(target: &Path, snapshots: &[BinSnapshot]) -> Result<(), String> {
    let root = fs::canonicalize(target).map_err(|error| error.to_string())?;
    for item in snapshots {
        for (_, path) in bin_restore_targets(target, item)? {
            let mut existing = path.as_path();
            while !existing.exists() {
                existing = existing.parent().ok_or_else(|| INVALID.to_owned())?;
            }
            if !fs::canonicalize(existing)
                .map_err(|error| error.to_string())?
                .starts_with(&root)
            {
                return Err(INVALID.into());
            }
        }
    }
    Ok(())
}
