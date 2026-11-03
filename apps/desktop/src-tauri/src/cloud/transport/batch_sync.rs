use super::*;
use std::collections::{HashMap, HashSet};

const MAX_BATCH_RECORDS: usize = 50;
const MAX_BATCH_BYTES: usize = 1024 * 1024;

pub(in crate::cloud) enum SyncRecords<'a> {
    Accounts(&'a [CloudAccountPayload]),
    Providers(&'a [ProviderSyncPayload]),
}

pub(in crate::cloud) struct SyncUpload<'a, R: Runtime> {
    pub app: &'a tauri::AppHandle<R>,
    pub client: &'a Client,
    pub settings: &'a mut AppSettings,
    pub credentials: &'a mut CloudCredentials,
}

pub(in crate::cloud) fn upload_sync_records<R: Runtime>(
    context: SyncUpload<'_, R>,
    records: SyncRecords<'_>,
) -> Result<usize, String> {
    let (kind, records) = match records {
        SyncRecords::Accounts(rows) => ("accounts", serde_json::to_value(rows)),
        SyncRecords::Providers(rows) => ("providers", serde_json::to_value(rows)),
    };
    let records = records.map_err(|error| error.to_string())?;
    sync_records(kind, records, |method, path, body| {
        let reading = method == Method::GET;
        let response = cloud_request(
            context.app,
            context.client,
            context.settings,
            context.credentials,
            method,
            path,
            body,
        )?;
        // Write-only roles can still upload. A denied read is never a synchronization receipt.
        if reading && response.status() == StatusCode::FORBIDDEN {
            return Ok(None);
        }
        if !response.status().is_success() {
            let label = if kind == "accounts" {
                "Cloud account upload"
            } else {
                "Cloud provider upload"
            };
            return Err(response_error(label, response));
        }
        response.json().map(Some).map_err(|error| error.to_string())
    })
}

// A fresh snapshot scopes comparisons to the current server and authenticated user.
// No local receipt survives a restart, deletion, server reset, or partial failure.
fn sync_records(
    kind: &str,
    records: Value,
    mut request: impl FnMut(Method, &str, Option<Value>) -> Result<Option<Value>, String>,
) -> Result<usize, String> {
    let records: Vec<Value> = serde_json::from_value(records).map_err(|error| error.to_string())?;
    if records.is_empty() {
        return Ok(0);
    }
    let path = format!("/sync/{kind}");
    let snapshot = request(Method::GET, &path, None)?;
    let pending = pending_records(kind, &records, snapshot.as_ref());
    let uploaded = pending.len();
    for batch in batches(pending)? {
        request(Method::PUT, &path, Some(json!({kind: batch})))?;
    }
    Ok(uploaded)
}

fn pending_records<'a>(kind: &str, local: &'a [Value], remote: Option<&Value>) -> Vec<&'a Value> {
    let Some(rows) = remote.and_then(|snapshot| snapshot[kind].as_array()) else {
        return local.iter().collect();
    };
    let by_id: HashMap<_, _> = rows
        .iter()
        .filter_map(|row| row["id"].as_str().map(|id| (id, row)))
        .collect();
    let deleted_key = if kind == "accounts" {
        "deletedAccountIds"
    } else {
        "deletedProviderIds"
    };
    let deleted: HashSet<_> = remote
        .and_then(|snapshot| snapshot[deleted_key].as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    local
        .iter()
        .filter(|row| {
            let id = row["id"].as_str().unwrap_or_default();
            !deleted.contains(id) && by_id.get(id).is_none_or(|old| needs_upload(row, old))
        })
        .collect()
}

fn needs_upload(local: &Value, remote: &Value) -> bool {
    if local["active"] == true && remote["active"] != true {
        return true;
    }
    // Official metadata is permission checked and updated by value, not field version.
    if remote["official"] == true {
        return local["note"] != remote["note"]
            || local["expiresAt"] != remote["expiresAt"]
            || (!local["privateDetails"].is_null()
                && newer_field(local, remote, "privateDetails"));
    }
    let Some(fields) = local["fieldModifiedAt"].as_object() else {
        return true;
    };
    fields.is_empty()
        || fields.keys().any(|key| {
            // Match server omission rules. In particular an omitted contextWindow clears it.
            let included = match key.as_str() {
                "privateDetails" | "requestOptions" => !local[key].is_null(),
                "balanceScript" | "marketSource" => local.get(key).is_some(),
                _ => true,
            };
            included && newer_field(local, remote, key)
        })
}

fn newer_field(local: &Value, remote: &Value, field: &str) -> bool {
    let version = |row: &Value| {
        row["fieldModifiedAt"][field]
            .as_str()
            .filter(|value| !value.is_empty())
            .or_else(|| row["lastModifiedAt"].as_str())
            .and_then(parse_last_modified)
    };
    match (version(local), version(remote)) {
        // admin-go canonicalizes field versions to milliseconds before merging.
        (Some(local), Some(remote)) => local.timestamp_millis() > remote.timestamp_millis(),
        _ => true,
    }
}

fn batches(records: Vec<&Value>) -> Result<Vec<Vec<&Value>>, String> {
    let mut result = Vec::new();
    let mut batch = Vec::new();
    // Reserve wrapper/separator space. Large individual records travel alone.
    let mut bytes = 32;
    for record in records {
        let size = serde_json::to_vec(record)
            .map_err(|error| error.to_string())?
            .len()
            + 1;
        if !batch.is_empty() && (batch.len() == MAX_BATCH_RECORDS || bytes + size > MAX_BATCH_BYTES)
        {
            result.push(std::mem::take(&mut batch));
            bytes = 32;
        }
        batch.push(record);
        bytes += size;
    }
    if !batch.is_empty() {
        result.push(batch);
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
