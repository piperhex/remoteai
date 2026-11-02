use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    thread,
};

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    providers::DEFAULT_OFFICIAL_MODEL,
    storage::{managed_auth_path, read_json, read_state, resolve_paths, write_json_atomic, Paths},
};

#[cfg(test)]
mod admin_tests;
mod client_version;
pub(crate) use client_version::model_client_version;
pub(crate) use client_version::MIN_CODEX_MODEL_CLIENT_VERSION;

const OFFICIAL_MODEL_CACHE_FILENAME: &str = "official-models-cache.json";
static OFFICIAL_MODEL_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static OFFICIAL_MODELS_APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct OfficialModelCatalog {
    pub(crate) models: Vec<String>,
    pub(crate) image_input_models: Vec<String>,
}

pub(crate) fn cached_catalog(paths: &Paths) -> OfficialModelCatalog {
    let value = read_json(&cache_path(paths)).unwrap_or_else(|_| json!({}));
    catalog_from_value(&value)
}

pub(crate) fn cached_model_names(paths: &Paths) -> Vec<String> {
    cached_catalog(paths).models
}

/// Reads the last successful official response, including all model capabilities.
pub(crate) fn cached_source_catalog(paths: &Paths) -> Result<Value, String> {
    read_json(&cache_path(paths))
}

/// Original capacities from the last official response, before local context overrides.
pub(crate) fn cached_context_windows(paths: &Paths) -> BTreeMap<String, u64> {
    cached_source_catalog(paths)
        .map(|catalog| context_windows_from_catalog(&catalog))
        .unwrap_or_default()
}

fn context_windows_from_catalog(catalog: &Value) -> BTreeMap<String, u64> {
    catalog["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let model = entry["slug"].as_str().or_else(|| entry["id"].as_str())?;
            let capacity = ["context_window", "max_context_window"]
                .iter()
                .find_map(|key| entry[key].as_u64().filter(|value| *value > 0))?;
            (!model.trim().is_empty()).then(|| (model.to_string(), capacity))
        })
        .collect()
}

#[cfg(test)]
mod context_tests;

/// Replaces the saved official catalog only after a successful, nonempty response.
pub(crate) struct OfficialCatalogUpdate<'a> {
    pub(crate) account_id: &'a str,
    pub(crate) catalog: Value,
    pub(crate) etag: Option<String>,
    pub(crate) client_version: &'a str,
}

/// Serializes cache writes and rejects responses belonging to an account that was replaced.
pub(crate) fn save_source_catalog(
    paths: &Paths,
    update: OfficialCatalogUpdate<'_>,
) -> Result<Value, String> {
    let cache = model_cache_value(update.catalog, update.etag, update.client_version)?;
    let _guard = OFFICIAL_MODEL_REFRESH_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if preferred_account_id(paths)? != update.account_id {
        return Err(
            "The selected account changed. Please refresh the model list again.".to_string(),
        );
    }
    write_json_atomic(&cache_path(paths), &cache)?;
    Ok(cache)
}

pub(crate) fn setup(app: AppHandle) {
    // Account changes still need the handle; startup must not fetch a catalog.
    let _ = OFFICIAL_MODELS_APP.set(app);
}

pub(crate) fn refresh_after_account_switch(account_id: &str) {
    let Some(app) = OFFICIAL_MODELS_APP.get().cloned() else {
        return;
    };
    let account_id = account_id.to_string();
    let _ = thread::Builder::new()
        .name("official-model-catalog-account-refresh".to_string())
        .spawn(move || {
            if let Err(error) = refresh_for_account_blocking(&app, &account_id) {
                eprintln!("Failed to refresh the official model catalog after switching: {error}");
            }
        });
}

/// Read Admin suggestions without requiring an account or changing the active runtime catalog.
#[tauri::command]
pub(crate) async fn read_admin_model_names<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<Vec<String>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::local_proxy::admin_model_catalog(&app)
            .map(|catalog| catalog_from_value(&catalog).models)
    })
    .await;
    match result {
        Ok(Ok(models)) => Ok(models),
        error => {
            eprintln!("Failed to read Admin model names: {error:?}");
            Err("Could not load the model list. Please try again.".to_string())
        }
    }
}

#[tauri::command]
pub(crate) async fn refresh_official_model_catalog<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_official_model_catalog_blocking(&app))
        .await
        .map_err(|error| format!("Official model catalog refresh task failed: {error}"))?
}

fn refresh_official_model_catalog_blocking<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    let paths = resolve_paths(app)?;
    let account_id = preferred_account_id(&paths)?;
    refresh_for_account_blocking(app, &account_id)
}

fn refresh_for_account_blocking<R: Runtime>(
    app: &AppHandle<R>,
    account_id: &str,
) -> Result<Vec<String>, String> {
    let paths = resolve_paths(app)?;
    let client_version = model_client_version(&paths);
    let fetched =
        crate::local_proxy::fetch_official_model_catalog(app, account_id, &client_version)?;
    let cache = save_source_catalog(
        &paths,
        OfficialCatalogUpdate {
            account_id,
            catalog: fetched.catalog,
            etag: fetched.etag,
            client_version: &client_version,
        },
    )?;
    let catalog = catalog_from_value(&cache);
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(catalog.models)
}

fn model_cache_value(
    catalog: Value,
    etag: Option<String>,
    client_version: &str,
) -> Result<Value, String> {
    let models = catalog
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "Official model catalog does not contain a model list".to_string())?;
    if !models
        .iter()
        .any(|entry| visible_model_name(entry).is_some())
    {
        return Err("Official model catalog is empty".to_string());
    }
    Ok(json!({
        "fetched_at": Utc::now().to_rfc3339(),
        "etag": etag,
        "client_version": client_version,
        "models": models,
    }))
}

fn preferred_account_id(paths: &Paths) -> Result<String, String> {
    let state = read_state(paths);
    for account_id in [
        state.active_account_id.as_deref(),
        state.local_proxy_openai_auth_account_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if managed_auth_path(paths, account_id).is_file() {
            return Ok(account_id.to_string());
        }
    }
    let account_ids = stored_account_ids(paths)?;
    account_ids
        .iter()
        .find(|id| !state.disabled_account_ids.contains(id))
        .or_else(|| account_ids.first())
        .cloned()
        .ok_or_else(|| "Add an official account before refreshing its model list".to_string())
}

fn stored_account_ids(paths: &Paths) -> Result<Vec<String>, String> {
    let mut ids = fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read the account store: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().join("auth.json").is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect::<Vec<_>>();
    ids.sort();
    Ok(ids)
}

fn cache_path(paths: &Paths) -> PathBuf {
    paths
        .state_file
        .with_file_name(OFFICIAL_MODEL_CACHE_FILENAME)
}

fn catalog_from_value(value: &Value) -> OfficialModelCatalog {
    let mut catalog = OfficialModelCatalog {
        models: Vec::new(),
        image_input_models: Vec::new(),
    };
    let mut seen = HashSet::new();
    let entries = value
        .get("models")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    for entry in entries {
        append_catalog_entry(&mut catalog, &mut seen, entry);
    }
    if catalog.models.is_empty() {
        catalog.models.push(DEFAULT_OFFICIAL_MODEL.to_string());
    }
    catalog
}

fn append_catalog_entry(
    catalog: &mut OfficialModelCatalog,
    seen: &mut HashSet<String>,
    entry: &Value,
) {
    let Some(model) = visible_model_name(entry) else {
        return;
    };
    if !seen.insert(model.to_string()) {
        return;
    }
    catalog.models.push(model.to_string());
    if supports_image_input(entry) {
        catalog.image_input_models.push(model.to_string());
    }
}

fn visible_model_name(entry: &Value) -> Option<&str> {
    if entry.get("visibility").and_then(Value::as_str) == Some("hide") {
        return None;
    }
    ["slug", "id"]
        .into_iter()
        .find_map(|field| entry.get(field).and_then(Value::as_str))
        .map(str::trim)
        .filter(|model| !model.is_empty())
}

fn supports_image_input(entry: &Value) -> bool {
    entry
        .get("input_modalities")
        .and_then(Value::as_array)
        .is_some_and(|modalities| {
            modalities
                .iter()
                .any(|modality| modality.as_str() == Some("image"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_uses_visible_remote_models_and_capabilities() {
        let catalog = catalog_from_value(&json!({
            "models": [
                { "slug": "gpt-hidden", "visibility": "hide" },
                {
                    "slug": "gpt-new",
                    "visibility": "list",
                    "input_modalities": ["text", "image"]
                },
                { "slug": "gpt-new", "visibility": "list" },
                { "id": "gpt-compatible" }
            ]
        }));

        assert_eq!(catalog.models, vec!["gpt-new", "gpt-compatible"]);
        assert_eq!(catalog.image_input_models, vec!["gpt-new"]);
    }

    #[test]
    fn empty_catalog_keeps_only_the_runtime_fallback() {
        let catalog = catalog_from_value(&json!({}));

        assert_eq!(catalog.models, vec![DEFAULT_OFFICIAL_MODEL]);
        assert!(catalog.image_input_models.is_empty());
    }
}
