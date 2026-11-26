use std::collections::HashSet;

use serde_json::{json, Value};

use super::SyncError;

const PROJECT_PREFIX: &str = "codex:project:";

pub(super) fn empty_layout() -> Value {
    json!({"sections": [], "collapsedSectionIds": [], "sectionOrder": []})
}

pub(super) fn merge(
    source: &Value,
    target: &mut Value,
    local_projects: &HashSet<String>,
) -> Result<usize, SyncError> {
    validate(source)?;
    validate(target)?;
    let mut assigned = assigned_items(target)?;
    let mut added = 0;
    for section in source["sections"].as_array().ok_or(SyncError::Schema)? {
        let Some(host_id) = local_section_id(section) else {
            continue;
        };
        if deleted(source, host_id) || deleted(target, host_id) {
            continue;
        }
        let items = missing_items(section, local_projects, &mut assigned);
        if items.is_empty() {
            continue;
        }
        added += items.len();
        append_items(target, section, host_id, items)?;
    }
    Ok(added)
}

fn assigned_items(target: &Value) -> Result<HashSet<String>, SyncError> {
    let mut assigned: HashSet<String> = target["sections"]
        .as_array()
        .ok_or(SyncError::Schema)?
        .iter()
        .flat_map(|section| section["itemKeys"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    for section in target["sections"].as_array().ok_or(SyncError::Schema)? {
        if let Some(pending) = section["pendingDeletionHostIdsByItemKey"].as_object() {
            assigned.extend(
                pending
                    .iter()
                    .filter(|(_, hosts)| {
                        hosts
                            .as_array()
                            .is_some_and(|hosts| hosts.iter().any(|host| host == "local"))
                    })
                    .map(|(key, _)| key.clone()),
            );
        }
    }
    Ok(assigned)
}

fn missing_items(
    section: &Value,
    local_projects: &HashSet<String>,
    assigned: &mut HashSet<String>,
) -> Vec<Value> {
    section["itemKeys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|key| {
            key.strip_prefix(PROJECT_PREFIX)
                .is_some_and(|id| local_projects.contains(id))
                && !section["pendingDeletionHostIdsByItemKey"][key]
                    .as_array()
                    .is_some_and(|hosts| hosts.iter().any(|host| host == "local"))
                && assigned.insert((*key).to_owned())
        })
        .map(|key| Value::String(key.to_string()))
        .collect()
}

fn append_items(
    target: &mut Value,
    source: &Value,
    host_id: &str,
    items: Vec<Value>,
) -> Result<(), SyncError> {
    let sections = target["sections"].as_array_mut().ok_or(SyncError::Schema)?;
    if let Some(section) = sections
        .iter_mut()
        .find(|section| local_section_id(section) == Some(host_id))
    {
        section["itemKeys"]
            .as_array_mut()
            .ok_or(SyncError::Schema)?
            .extend(items);
        return Ok(());
    }
    // Renderer IDs differ between accounts. Match by the shared local host section ID.
    // Never copy remote hosts, thread IDs, cloud projects or deletion/migration bookkeeping.
    let id = uuid::Uuid::new_v4().to_string();
    sections.push(json!({
        "id": id, "name": source["name"], "appearance": source.get("appearance"),
        "hostSectionIds": {"local": host_id}, "itemKeys": items
    }));
    let order = target["sectionOrder"]
        .as_array_mut()
        .ok_or(SyncError::Schema)?;
    let position = order
        .iter()
        .position(|key| key == "threads" || key == "chats")
        .unwrap_or(order.len());
    order.insert(position, Value::String(format!("custom:{id}")));
    Ok(())
}

fn local_section_id(section: &Value) -> Option<&str> {
    section
        .get("hostSectionIds")?
        .get("local")?
        .as_str()
        .filter(|id| !id.is_empty())
}

fn deleted(layout: &Value, host_id: &str) -> bool {
    layout["appServerDeletedSectionIds"]
        .as_array()
        .is_some_and(|ids| ids.iter().any(|id| id == host_id))
}

fn validate(layout: &Value) -> Result<(), SyncError> {
    let sections = layout
        .get("sections")
        .and_then(Value::as_array)
        .ok_or(SyncError::Schema)?;
    for key in ["sectionOrder", "collapsedSectionIds"] {
        let values = layout
            .get(key)
            .and_then(Value::as_array)
            .ok_or(SyncError::Schema)?;
        if values.iter().any(|value| !value.is_string()) {
            return Err(SyncError::Schema);
        }
    }
    if layout
        .get("appServerDeletedSectionIds")
        .is_some_and(|ids| !string_array(ids))
    {
        return Err(SyncError::Schema);
    }
    let mut ids = HashSet::new();
    let mut host_ids = HashSet::new();
    for section in sections {
        let id = section
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or(SyncError::Schema)?;
        let items = section
            .get("itemKeys")
            .and_then(Value::as_array)
            .ok_or(SyncError::Schema)?;
        if !ids.insert(id)
            || section
                .get("name")
                .and_then(Value::as_str)
                .is_none_or(|name| name.trim().is_empty())
            || items.iter().any(|item| !item.is_string())
            || local_section_id(section).is_some_and(|host| !host_ids.insert(host))
        {
            return Err(SyncError::Schema);
        }
        validate_host_metadata(section)?;
    }
    Ok(())
}

fn string_array(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().all(Value::is_string))
}

fn validate_host_metadata(section: &Value) -> Result<(), SyncError> {
    if let Some(hosts) = section.get("hostSectionIds") {
        if hosts
            .as_object()
            .is_none_or(|hosts| !hosts.values().all(Value::is_string))
        {
            return Err(SyncError::Schema);
        }
    }
    if let Some(pending) = section.get("pendingDeletionHostIdsByItemKey") {
        if pending
            .as_object()
            .is_none_or(|pending| !pending.values().all(string_array))
        {
            return Err(SyncError::Schema);
        }
    }
    Ok(())
}
