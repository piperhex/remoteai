use super::*;
use crate::third_party_apps::tests::provider;

#[test]
fn open_code_update_preserves_other_providers_and_selects_managed_model() {
    let mut config = json!({ "provider": { "keep": { "npm": "existing" } } });
    let mut provider = provider();
    provider.models.push("second-model".to_string());
    update_open_code_config(&mut config, Some(&provider)).unwrap();
    assert_eq!(config["provider"]["keep"]["npm"], "existing");
    assert_eq!(config["model"], "codex-switch/test-model");
    assert_eq!(
        config["provider"]["codex-switch"]["options"]["apiKey"],
        "secret"
    );
    assert_eq!(
        config["provider"]["codex-switch"]["models"]["test-model"]["name"],
        "test-model"
    );
    assert_eq!(
        config["provider"]["codex-switch"]["models"]["second-model"]["name"],
        "second-model"
    );
}

#[test]
fn open_code_responses_provider_uses_the_native_openai_sdk() {
    let mut config = json!({});
    let mut provider = provider();
    provider.api_format = crate::models::ProviderApiFormat::OpenaiResponses;
    update_open_code_config(&mut config, Some(&provider)).unwrap();
    assert_eq!(config["provider"]["codex-switch"]["npm"], "@ai-sdk/openai");
}

#[test]
fn open_code_model_descriptor_preserves_image_input_capability() {
    let mut config = json!({});
    let mut provider = provider();
    provider.image_input_models = vec![provider.model.clone()];
    update_open_code_config(&mut config, Some(&provider)).unwrap();
    assert_eq!(
        config["provider"]["codex-switch"]["models"]["test-model"]["modalities"]["input"],
        json!(["text", "image"])
    );
}

#[test]
fn open_claw_update_preserves_unrelated_sections() {
    let mut config = json!({ "gateway": { "token": "keep" } });
    let provider = provider();
    update_open_claw_config(&mut config, Some(&provider)).unwrap();
    assert_eq!(config["gateway"]["token"], "keep");
    assert_eq!(
        config["agents"]["defaults"]["model"]["primary"],
        "codex-switch/test-model"
    );
}

#[test]
fn z_code_responses_provider_uses_the_native_openai_kind() {
    let mut config = json!({});
    let mut provider = provider();
    provider.api_format = crate::models::ProviderApiFormat::OpenaiResponses;
    update_z_code_config(&mut config, Some(&provider)).unwrap();
    assert_eq!(config["provider"]["codex-switch"]["kind"], "openai");
}

#[test]
fn open_viking_updates_vlm_without_replacing_existing_embedding_model() {
    let mut config = json!({ "embedding": { "dense": { "model": "embedding-model" } } });
    let provider = provider();
    update_open_viking_config(&mut config, &provider).unwrap();
    assert_eq!(config["vlm"]["model"], "test-model");
    assert_eq!(config["embedding"]["dense"]["model"], "embedding-model");
}

#[test]
fn work_buddy_clear_removes_only_codex_switch_models() {
    let mut config = json!({
        "models": [
            { "id": "keep-model", "vendor": "Custom" },
            { "id": "managed-model", "codexSwitchManaged": true }
        ],
        "availableModels": ["keep-model", "managed-model"]
    });
    update_work_buddy_config(&mut config, None).unwrap();
    assert_eq!(config["models"].as_array().map(Vec::len), Some(1));
    assert_eq!(config["models"][0]["id"], "keep-model");
    assert_eq!(config["availableModels"], json!(["keep-model"]));
}

#[test]
fn work_buddy_sync_accepts_empty_array_root() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join(".workbuddy/models.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "[]").unwrap();
    let provider = provider();

    sync_work_buddy(home.path(), Some(&provider)).unwrap();

    let config: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(config["models"].as_array().unwrap().len(), 1);
    assert_eq!(config["models"][0]["id"], provider.model);
    assert_eq!(config["models"][0][WORK_BUDDY_MANAGED_MARKER], true);
    assert_eq!(config["availableModels"], json!([provider.model]));
}

#[test]
fn work_buddy_sync_preserves_array_models_and_is_idempotent() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join(".workbuddy/models.json");
    let existing = json!({
        "id": "keep-model",
        "vendor": "Custom",
        "customOptions": { "keep": true }
    });
    write_json_atomic(&path, &json!([existing])).unwrap();
    let provider = provider();

    sync_work_buddy(home.path(), Some(&provider)).unwrap();
    sync_work_buddy(home.path(), Some(&provider)).unwrap();

    let config: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(config["models"].as_array().unwrap().len(), 2);
    assert_eq!(config["models"][0], existing);
    assert_eq!(config["models"][1]["id"], provider.model);
    assert_eq!(config["availableModels"], json!([provider.model]));

    sync_work_buddy(home.path(), None).unwrap();
    let cleared: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(cleared["models"], json!([existing]));
}

#[test]
fn work_buddy_sync_preserves_object_fields_and_available_models() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join(".workbuddy/models.json");
    let existing = json!({ "id": "keep-model", "vendor": "Custom" });
    write_json_atomic(
        &path,
        &json!({
            "models": [existing],
            "availableModels": ["keep-model"],
            "customOptions": { "keep": true }
        }),
    )
    .unwrap();
    let provider = provider();

    sync_work_buddy(home.path(), Some(&provider)).unwrap();

    let config: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(config["models"][0], existing);
    assert_eq!(
        config["availableModels"],
        json!(["keep-model", provider.model])
    );
    assert_eq!(config["customOptions"], json!({ "keep": true }));
}

#[test]
fn work_buddy_sync_initializes_missing_config() {
    let home = tempfile::tempdir().unwrap();
    let provider = provider();

    sync_work_buddy(home.path(), Some(&provider)).unwrap();

    let path = home.path().join(".workbuddy/models.json");
    let config: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(config["models"][0]["id"], provider.model);
}

#[test]
fn work_buddy_sync_rejects_invalid_configs_without_overwriting() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join(".workbuddy/models.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let provider = provider();
    for source in [
        "null",
        "true",
        "42",
        "\"invalid\"",
        "{",
        "{models: false}",
        "{models: [], availableModels: false}",
    ] {
        fs::write(&path, source).unwrap();
        assert!(
            sync_work_buddy(home.path(), Some(&provider)).is_err(),
            "{source}"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }
}

#[test]
fn object_only_json_reader_still_rejects_array_roots() {
    let file = tempfile::NamedTempFile::new().unwrap();
    fs::write(file.path(), "[]").unwrap();
    assert!(read_json_compatible(file.path()).is_err());
}

#[test]
fn work_buddy_sync_accepts_json5_array_root() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join(".workbuddy/models.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        "[/* existing model */ {id: 'keep-model', vendor: 'Custom'},]",
    )
    .unwrap();

    sync_work_buddy(home.path(), Some(&provider())).unwrap();

    let config: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(config["models"][0]["id"], "keep-model");
    assert_eq!(config["models"].as_array().unwrap().len(), 2);
}
