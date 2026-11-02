use std::{fs, path::PathBuf};

use serde_json::json;

use super::*;

struct CacheFixture {
    root: PathBuf,
    paths: Paths,
}

impl CacheFixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("official-model-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let paths = Paths {
            codex_home: root.clone(),
            current_auth: root.join("auth.json"),
            current_config: root.join("config.toml"),
            accounts: root.join("accounts"),
            providers: root.join("providers"),
            config_backup: root.join("config.backup"),
            state_file: root.join("state.json"),
        };
        fs::create_dir_all(paths.accounts.join("test-account")).unwrap();
        fs::write(paths.accounts.join("test-account/auth.json"), "{}").unwrap();
        crate::storage::write_json_atomic(
            &paths.state_file,
            &json!({"active_account_id": "test-account"}),
        )
        .unwrap();
        Self { root, paths }
    }

    fn save(&self, catalog: serde_json::Value) -> Result<serde_json::Value, String> {
        self.save_from(catalog, official_models::OfficialCatalogSource::LocalProxy)
    }

    fn save_from(
        &self,
        catalog: serde_json::Value,
        source: official_models::OfficialCatalogSource,
    ) -> Result<serde_json::Value, String> {
        official_models::save_source_catalog(
            &self.paths,
            official_models::OfficialCatalogUpdate {
                account_id: "test-account",
                catalog,
                etag: None,
                client_version: "0.152.0",
                source,
            },
        )
    }
}

impl Drop for CacheFixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn successful_catalog() -> serde_json::Value {
    json!({"models": [
        {"slug": "gpt-5.6-sol", "additional_speed_tiers": ["fast"]},
        {
            "slug": "gpt-6-astra", "input_modalities": ["text", "image"],
            "service_tiers": [{"id": "priority"}],
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "max"}]
        },
        {"slug": "gpt-hidden", "visibility": "hide"}
    ]})
}

#[test]
fn legacy_uniform_overrides_are_not_treated_as_official_context_defaults() {
    let fixture = CacheFixture::new();
    let overridden = json!({"models": [
        {"slug": "first", "context_window": 600000, "max_context_window": 600000},
        {"slug": "second", "context_window": 600000, "max_context_window": 600000}
    ]});
    crate::storage::write_json_atomic(
        &fixture.root.join("official-models-cache.json"),
        &overridden,
    )
    .unwrap();
    assert!(official_models::cached_context_windows(&fixture.paths).is_empty());
    fixture.save(overridden).unwrap();
    assert!(official_models::cached_context_windows(&fixture.paths).is_empty());
}

#[test]
fn proxy_refresh_preserves_upstream_defaults_across_saved_catalog_reloads() {
    let fixture = CacheFixture::new();
    let upstream = json!({"models": [
        {"slug": "first", "context_window": 272000, "max_context_window": 1000000},
        {"slug": "second", "context_window": 400000}
    ]});
    fixture
        .save_from(upstream, official_models::OfficialCatalogSource::Upstream)
        .unwrap();
    fixture
        .save(json!({"models": [
            {"slug": "first", "context_window": 600000, "max_context_window": 600000},
            {"slug": "second", "context_window": 600000, "max_context_window": 600000}
        ]}))
        .unwrap();
    let defaults = official_models::cached_context_windows(&fixture.paths);
    assert_eq!(defaults["first"], 272000);
    assert_eq!(defaults["second"], 400000);
    assert_eq!(
        official_models::cached_source_catalog(&fixture.paths).unwrap()["models"][0]
            ["context_window"],
        600000
    );

    fixture
        .save_from(
            json!({"models": [
                {"slug": "first", "context_window": 600000},
                {"slug": "second", "context_window": 600000}
            ]}),
            official_models::OfficialCatalogSource::Upstream,
        )
        .unwrap();
    assert!(official_models::cached_context_windows(&fixture.paths)
        .values()
        .all(|capacity| *capacity == 600000));
}

#[test]
fn failure_after_switch_reuses_persisted_models_and_capabilities() {
    let fixture = CacheFixture::new();
    fixture.save(successful_catalog()).unwrap();

    // Read from disk again: fallback must also work after restarting the manager.
    let cached = cached_request(&fixture.paths, "gpt-6-astra");
    let (request, using_cached_catalog) = fallback_request(cached, "gpt-6-astra");

    assert!(using_cached_catalog);
    assert_eq!(request.models, vec!["gpt-5.6-sol", "gpt-6-astra"]);
    assert_eq!(request.fast_mode_models, request.models);
    assert_eq!(request.image_input_models, vec!["gpt-6-astra"]);
    assert_eq!(request.selected_model, "gpt-6-astra");
    assert_eq!(
        request.model_reasoning_efforts["gpt-6-astra"],
        vec![
            crate::models::ReasoningEffort::Low,
            crate::models::ReasoningEffort::Max,
        ]
    );
}

#[test]
fn unusable_responses_do_not_replace_the_last_successful_catalog() {
    let fixture = CacheFixture::new();
    fixture.save(successful_catalog()).unwrap();

    for invalid in [
        json!({}),
        json!({"models": []}),
        json!({"models": [{}]}),
        json!({"models": [{"slug": "hidden", "visibility": "hide"}]}),
    ] {
        assert!(fixture.save(invalid).is_err());
        let request = cached_request(&fixture.paths, "gpt-5.6-sol").unwrap();
        assert_eq!(request.models, vec!["gpt-5.6-sol", "gpt-6-astra"]);
    }
}

#[test]
fn recovery_replaces_the_saved_catalog_for_the_next_failure() {
    let fixture = CacheFixture::new();
    fixture.save(successful_catalog()).unwrap();
    fixture
        .save(json!({"models": [{"slug": "new-official-model"}]}))
        .unwrap();

    let request = cached_request(&fixture.paths, "new-official-model").unwrap();
    assert_eq!(request.models, vec!["new-official-model"]);
    assert!(request.fast_mode_models.is_empty());
    assert!(request.image_input_models.is_empty());
}

#[test]
fn a_late_response_from_the_previous_account_cannot_replace_the_new_catalog() {
    let fixture = CacheFixture::new();
    fixture.save(successful_catalog()).unwrap();
    fs::create_dir_all(fixture.paths.accounts.join("new-account")).unwrap();
    fs::write(fixture.paths.accounts.join("new-account/auth.json"), "{}").unwrap();
    let mut state = crate::storage::read_state(&fixture.paths);
    state.active_account_id = Some("new-account".to_string());
    crate::storage::write_state(&fixture.paths, &state).unwrap();
    official_models::save_source_catalog(
        &fixture.paths,
        official_models::OfficialCatalogUpdate {
            account_id: "new-account",
            catalog: json!({"models": [{"slug": "new-pro-model"}]}),
            etag: None,
            client_version: "0.152.0",
            source: official_models::OfficialCatalogSource::LocalProxy,
        },
    )
    .unwrap();

    assert!(fixture.save(successful_catalog()).is_err());
    assert_eq!(
        cached_request(&fixture.paths, "new-pro-model")
            .unwrap()
            .models,
        vec!["new-pro-model"]
    );
}

#[test]
fn provider_routes_are_never_treated_as_the_official_refresh_target() {
    let fixture = CacheFixture::new();
    assert_eq!(
        official_account_id(&fixture.paths).as_deref(),
        Some("test-account")
    );
    let mut state = crate::storage::read_state(&fixture.paths);
    state.active_provider_id = Some("custom-provider".to_string());
    crate::storage::write_state(&fixture.paths, &state).unwrap();
    assert!(official_account_id(&fixture.paths).is_none());
    state.active_provider_id = None;
    state.active_provider_group = Some("provider-group".to_string());
    crate::storage::write_state(&fixture.paths, &state).unwrap();
    assert!(official_account_id(&fixture.paths).is_none());
}

#[test]
fn missing_or_corrupt_cache_does_not_pin_the_picker_to_the_default() {
    let fixture = CacheFixture::new();
    for contents in [None, Some("not-json")] {
        if let Some(contents) = contents {
            fs::write(fixture.root.join("official-models-cache.json"), contents).unwrap();
        }
        let cached = cached_request(&fixture.paths, "gpt-5.6-sol");
        let (request, using_cached_catalog) = fallback_request(cached, "gpt-5.6-sol");
        assert!(!using_cached_catalog);
        assert!(request.models.is_empty());
        assert!(request.fast_mode_models.is_empty());
    }
}

#[test]
fn failure_notification_contains_only_frontend_safe_cache_state() {
    assert_eq!(
        serde_json::to_value(ModelRefreshFailure {
            using_cached_catalog: true
        })
        .unwrap(),
        json!({"usingCachedCatalog": true})
    );
}
