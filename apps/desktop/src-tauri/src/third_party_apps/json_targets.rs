use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};

use crate::{models::ProviderProfile, storage::write_json_atomic};

use super::{provider_context_window, provider_protocol, ProviderProtocol, MANAGED_PROVIDER_ID};

const WORK_BUDDY_MANAGED_MARKER: &str = "codexSwitchManaged";

pub(super) fn sync_open_code(
    home: &Path,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let directory = home.join(".config").join("opencode");
    let path = preferred_json_path(&directory, "opencode");
    let mut config = read_json_compatible(&path)?;
    update_open_code_config(&mut config, provider)?;
    write_json_atomic(&path, &config)
}

pub(super) fn sync_z_code(home: &Path, provider: Option<&ProviderProfile>) -> Result<(), String> {
    let path = home.join(".zcode").join("v2").join("config.json");
    let mut config = read_json_compatible(&path)?;
    update_z_code_config(&mut config, provider)?;
    write_json_atomic(&path, &config)
}

pub(super) fn sync_open_claw(
    home: &Path,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let path = home.join(".openclaw").join("openclaw.json");
    let mut config = read_json_compatible(&path)?;
    update_open_claw_config(&mut config, provider)?;
    write_json_atomic(&path, &config)
}

pub(super) fn sync_work_buddy(
    home: &Path,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let path = home.join(".workbuddy").join("models.json");
    let mut config = read_work_buddy_config(&path)?;
    update_work_buddy_config(&mut config, provider)?;
    write_json_atomic(&path, &config)
}

pub(super) fn sync_open_viking(
    home: &Path,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let Some(provider) = provider else {
        return Ok(());
    };
    let path = std::env::var_os("OPENVIKING_CONFIG_FILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".openviking").join("ov.conf"));
    let mut config = read_json_compatible(&path)?;
    update_open_viking_config(&mut config, provider)?;
    write_json_atomic(&path, &config)
}

fn preferred_json_path(directory: &Path, stem: &str) -> PathBuf {
    let jsonc = directory.join(format!("{stem}.jsonc"));
    if jsonc.exists() {
        return jsonc;
    }
    directory.join(format!("{stem}.json"))
}

fn read_json_compatible(path: &Path) -> Result<Value, String> {
    read_json_value(path).and_then(require_object)
}

fn read_work_buddy_config(path: &Path) -> Result<Value, String> {
    match read_json_value(path)? {
        // WorkBuddy accepts both a model array and an object containing models.
        Value::Array(models) => Ok(json!({ "models": models })),
        value => require_object(value),
    }
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let source = fs::read_to_string(path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    json5::from_str::<Value>(&source)
        .map_err(|error| format!("{} 的配置格式无效：{error}", path.display()))
}

fn require_object(value: Value) -> Result<Value, String> {
    if value.is_object() {
        Ok(value)
    } else {
        Err("应用配置的根节点必须是对象".to_string())
    }
}

fn root_object(config: &mut Value) -> Result<&mut Map<String, Value>, String> {
    config
        .as_object_mut()
        .ok_or_else(|| "应用配置的根节点必须是对象".to_string())
}

fn child_object<'a>(parent: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let value = parent
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    value
        .as_object_mut()
        .expect("value was replaced with an object")
}

fn update_open_code_config(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let Some(provider) = provider else {
        let root = root_object(config)?;
        child_object(root, "provider").remove(MANAGED_PROVIDER_ID);
        remove_managed_model_selectors(root);
        return Ok(());
    };
    let root = root_object(config)?;
    root.entry("$schema".to_string())
        .or_insert_with(|| json!("https://opencode.ai/config.json"));
    {
        let providers = child_object(root, "provider");
        providers.insert(
            MANAGED_PROVIDER_ID.to_string(),
            open_code_provider(provider),
        );
    }
    set_model_selectors(root, provider);
    Ok(())
}

fn open_code_provider(provider: &ProviderProfile) -> Value {
    let npm = match provider_protocol(provider) {
        ProviderProtocol::Anthropic => "@ai-sdk/anthropic",
        ProviderProtocol::OpenaiResponses => "@ai-sdk/openai",
        ProviderProtocol::OpenaiChat => "@ai-sdk/openai-compatible",
    };
    let models = provider
        .models
        .iter()
        .map(|model| (model.clone(), model_descriptor(provider, model)))
        .collect::<Map<_, _>>();
    json!({
        "npm": npm,
        "name": provider.name,
        "options": { "baseURL": provider.base_url, "apiKey": provider.api_key },
        "models": models
    })
}

fn update_z_code_config(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let Some(provider) = provider else {
        let root = root_object(config)?;
        child_object(root, "provider").remove(MANAGED_PROVIDER_ID);
        remove_managed_model_selectors(root);
        return Ok(());
    };
    let root = root_object(config)?;
    root.entry("$schema".to_string())
        .or_insert_with(|| json!("https://opencode.ai/config.json"));
    let kind = match provider_protocol(provider) {
        ProviderProtocol::Anthropic => "anthropic",
        ProviderProtocol::OpenaiChat => "openai-compatible",
        ProviderProtocol::OpenaiResponses => "openai",
    };
    {
        let providers = child_object(root, "provider");
        providers.insert(MANAGED_PROVIDER_ID.to_string(), json!({
            "name": provider.name,
            "kind": kind,
            "source": "custom",
            "options": { "baseURL": provider.base_url, "apiKey": provider.api_key, "apiKeyRequired": true },
            "models": { provider.model.clone(): model_descriptor(provider, &provider.model) }
        }));
    }
    set_model_selectors(root, provider);
    Ok(())
}

fn set_model_selectors(root: &mut Map<String, Value>, provider: &ProviderProfile) {
    let selected = format!("{}/{}", MANAGED_PROVIDER_ID, provider.model);
    root.insert("model".to_string(), Value::String(selected.clone()));
    root.insert("small_model".to_string(), Value::String(selected));
}

fn remove_managed_model_selectors(root: &mut Map<String, Value>) {
    let prefix = format!("{MANAGED_PROVIDER_ID}/");
    for key in ["model", "small_model"] {
        let managed = root
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| value.starts_with(&prefix));
        if managed {
            root.remove(key);
        }
    }
}

fn update_open_claw_config(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let Some(provider) = provider else {
        let root = root_object(config)?;
        if let Some(models) = root.get_mut("models").and_then(Value::as_object_mut) {
            if let Some(providers) = models.get_mut("providers").and_then(Value::as_object_mut) {
                providers.remove(MANAGED_PROVIDER_ID);
            }
        }
        clear_open_claw_primary(root);
        return Ok(());
    };
    let root = root_object(config)?;
    {
        let models = child_object(root, "models");
        models.insert("mode".to_string(), json!("merge"));
        let providers = child_object(models, "providers");
        providers.insert(
            MANAGED_PROVIDER_ID.to_string(),
            open_claw_provider(provider),
        );
    }
    let agents = child_object(root, "agents");
    let defaults = child_object(agents, "defaults");
    let model = child_object(defaults, "model");
    model.insert(
        "primary".to_string(),
        json!(format!("{}/{}", MANAGED_PROVIDER_ID, provider.model)),
    );
    Ok(())
}

fn open_claw_provider(provider: &ProviderProfile) -> Value {
    let api = match provider_protocol(provider) {
        ProviderProtocol::Anthropic => "anthropic-messages",
        ProviderProtocol::OpenaiResponses => "openai-responses",
        ProviderProtocol::OpenaiChat => "openai-completions",
    };
    let input = if provider.image_input_models.contains(&provider.model) {
        vec!["text", "image"]
    } else {
        vec!["text"]
    };
    json!({
        "baseUrl": provider.base_url,
        "apiKey": provider.api_key,
        "api": api,
        "models": [{
            "id": provider.model,
            "name": provider.model,
            "contextWindow": provider_context_window(provider),
            "maxTokens": 8192,
            "input": input,
            "reasoning": false
        }]
    })
}

fn clear_open_claw_primary(root: &mut Map<String, Value>) {
    let prefix = format!("{MANAGED_PROVIDER_ID}/");
    let Some(primary) = root
        .get_mut("agents")
        .and_then(Value::as_object_mut)
        .and_then(|agents| agents.get_mut("defaults"))
        .and_then(Value::as_object_mut)
        .and_then(|defaults| defaults.get_mut("model"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    let managed = primary
        .get("primary")
        .and_then(Value::as_str)
        .is_some_and(|value| value.starts_with(&prefix));
    if managed {
        primary.remove("primary");
    }
}

fn update_work_buddy_config(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let root = root_object(config)?;
    let models = root
        .entry("models".to_string())
        .or_insert_with(|| json!([]));
    let models = models
        .as_array_mut()
        .ok_or_else(|| "WorkBuddy 的 models 必须是数组".to_string())?;
    let managed_models = models
        .iter()
        .filter(|entry| entry.get(WORK_BUDDY_MANAGED_MARKER) == Some(&Value::Bool(true)))
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    models.retain(|entry| {
        entry.get(WORK_BUDDY_MANAGED_MARKER) != Some(&Value::Bool(true))
            && provider.is_none_or(|provider| {
                entry.get("id").and_then(Value::as_str) != Some(provider.model.as_str())
            })
    });
    if let Some(provider) = provider {
        models.push(work_buddy_model(provider));
    }
    let available = root
        .entry("availableModels".to_string())
        .or_insert_with(|| json!([]));
    let available = available
        .as_array_mut()
        .ok_or_else(|| "WorkBuddy 的 availableModels 必须是数组".to_string())?;
    available.retain(|value| {
        !managed_models
            .iter()
            .any(|model| value.as_str() == Some(model.as_str()))
    });
    if let Some(provider) = provider {
        available.retain(|value| value.as_str() != Some(provider.model.as_str()));
        available.push(json!(provider.model));
    }
    Ok(())
}

fn work_buddy_model(provider: &ProviderProfile) -> Value {
    let url = provider.base_url.trim_end_matches('/').to_string();
    json!({
        "id": provider.model,
        "name": provider.model,
        "vendor": "Custom",
        "url": url,
        "apiKey": provider.api_key,
        "maxInputTokens": provider_context_window(provider),
        "maxOutputTokens": 8192,
        "supportsToolCall": true,
        "supportsImages": provider.image_input_models.contains(&provider.model),
        "supportsReasoning": provider.model_reasoning_efforts.contains_key(&provider.model),
        "useCustomProtocol": false,
        "codexSwitchManaged": true
    })
}

fn update_open_viking_config(config: &mut Value, provider: &ProviderProfile) -> Result<(), String> {
    let root = root_object(config)?;
    {
        let vlm = child_object(root, "vlm");
        vlm.insert(
            "provider".to_string(),
            json!(open_viking_provider(provider)),
        );
        vlm.insert("api_key".to_string(), json!(provider.api_key));
        vlm.insert("api_base".to_string(), json!(provider.base_url));
        vlm.insert("model".to_string(), json!(provider.model));
    }
    if let Some(embedding) = root.get_mut("embedding").and_then(Value::as_object_mut) {
        let dense = embedding
            .entry("dense".to_string())
            .or_insert_with(|| json!({}));
        if let Some(dense) = dense.as_object_mut() {
            dense.insert(
                "provider".to_string(),
                json!(open_viking_provider(provider)),
            );
            dense.insert("api_key".to_string(), json!(provider.api_key));
            dense.insert("api_base".to_string(), json!(provider.base_url));
        }
    }
    Ok(())
}

fn open_viking_provider(provider: &ProviderProfile) -> &'static str {
    let base_url = provider.base_url.to_ascii_lowercase();
    if base_url.contains("volces.com") || base_url.contains("bytepluses.com") {
        "volcengine"
    } else if base_url.contains("kimi.com") || base_url.contains("moonshot") {
        "kimi"
    } else if base_url.contains("bigmodel.cn") || base_url.contains("z.ai") {
        "glm"
    } else {
        "openai"
    }
}

fn model_descriptor(provider: &ProviderProfile, model: &str) -> Value {
    let input = if provider
        .image_input_models
        .iter()
        .any(|candidate| candidate == model)
    {
        vec!["text", "image"]
    } else {
        vec!["text"]
    };
    let context_window = provider
        .model_context_windows
        .get(model)
        .copied()
        .or(provider.context_window)
        .unwrap_or(128_000);
    json!({
        "name": model,
        "limit": { "context": context_window, "output": 8192 },
        "modalities": { "input": input, "output": ["text"] }
    })
}

#[cfg(test)]
#[path = "json_targets/tests.rs"]
mod tests;
