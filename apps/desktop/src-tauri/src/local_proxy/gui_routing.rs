use super::*;
use crate::codex_gui::account_selection::{self, GuiAccountSelection};

const GUI_PREFIX: &str = "/codex-gui";

pub(super) fn upstream_path(url: &str) -> Option<&str> {
    url.strip_prefix(GUI_PREFIX)
        .filter(|path| path.starts_with('/'))
}

pub(super) struct GuiProxyRequest<'a, R: Runtime> {
    pub app: &'a tauri::AppHandle<R>,
    pub method: &'a Method,
    pub url: &'a str,
    pub headers: &'a [(String, String)],
    pub body: Vec<u8>,
    pub session_id: Option<&'a str>,
    pub session_request_id: Option<u64>,
}

pub(super) fn selected_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    selection: &GuiAccountSelection,
) -> Result<ActiveTarget, String> {
    match selection {
        GuiAccountSelection::Account(_) => Ok(ActiveTarget::Official {
            model: providers::official_model(),
        }),
        GuiAccountSelection::Provider(id) => {
            let provider = providers::read_provider(&resolve_paths(app)?, id)?;
            providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
            Ok(ActiveTarget::Provider(Box::new(provider)))
        }
        GuiAccountSelection::Aggregate(id) => {
            let paths = resolve_paths(app)?;
            let config = aggregate_api::read_config(&paths, id)?;
            if !config.enabled {
                return Err("Aggregate API is disabled".into());
            }
            let profiles = aggregate_api::member_profiles(&paths, &config)?;
            Ok(ActiveTarget::Aggregate(Box::new(AggregateTarget {
                config,
                profiles,
            })))
        }
        GuiAccountSelection::None => Err("请先选择 Codex GUI 账户。".to_string()),
    }
}

/// GUI requests and retries use only GUI switching rules. Shared fallback and concurrent
/// routing cannot replace the target, even when both workspaces select the same account.
pub(super) fn handle<R: Runtime>(
    request: GuiProxyRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    if let Some(id) = request.session_id {
        super::gui_context::mark_session(id);
    }
    handle_selected(request).map_err(|error| {
        diagnostic_event(json!({
            "event": "gui_request_failed",
            "errorId": super::error_messages::error_id(&error),
            "error": crate::error_logs::sanitize_diagnostic_message(&error)
        }));
        super::error_messages::gui(&error)
    })
}

fn handle_selected<R: Runtime>(request: GuiProxyRequest<'_, R>) -> Result<UpstreamPayload, String> {
    if is_anthropic_messages_endpoint(request_path(request.url)) {
        return super::gui_cli::messages(request);
    }
    if is_anthropic_count_tokens_endpoint(request_path(request.url)) {
        return Ok(super::gui_cli::count_tokens(&request.body));
    }
    if *request.method == Method::Get && request_path(request.url) == "/v1/cli-models" {
        let state = request.app.state::<crate::codex_gui::GuiState>();
        let _permit = state.model_discovery.begin();
        return handle_selected(GuiProxyRequest {
            url: "/v1/models",
            ..request
        });
    }
    if *request.method == Method::Get
        && matches!(request_path(request.url), "/models" | "/v1/models")
    {
        let snapshot =
            account_selection::snapshot(request.app).map_err(|error| error.to_string())?;
        let target = selected_target(request.app, &snapshot.selection)?;
        let account_id = match &snapshot.selection {
            GuiAccountSelection::Account(id) => Some(id.as_str()),
            _ => None,
        };
        let payload = models(&request, &target, account_id)?;
        // A slow response from a previous account must not repopulate the CLI's catalog cache.
        return account_selection::with_current(request.app, snapshot.revision, || payload)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "账户已切换，请重新刷新模型列表。".to_string());
    }
    super::gui_forwarding::forward(request)
}

fn models<R: Runtime>(
    request: &GuiProxyRequest<'_, R>,
    target: &ActiveTarget,
    account_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    if let ActiveTarget::Aggregate(aggregate) = target {
        let provider = aggregate_api::logical_profile(&aggregate.config, &aggregate.profiles)?;
        return super::gui_context::model_catalog(
            provider_models_payload_with_image_route(&provider, false),
            |catalog| {
                crate::codex_gui::model_context::prepare_catalog(request.app, catalog, false)
                    .map_err(|error| error.to_string())
            },
        );
    }
    if let ActiveTarget::Provider(provider) = target {
        if !providers::uses_upstream_official_models(provider) {
            return super::gui_context::model_catalog(
                provider_models_payload_with_image_route(provider, false),
                |catalog| {
                    crate::codex_gui::model_context::prepare_catalog(request.app, catalog, false)
                        .map_err(|error| error.to_string())
                },
            );
        }
    }
    if !request
        .app
        .try_state::<crate::codex_gui::GuiState>()
        .is_some_and(|state| state.model_discovery.allowed())
    {
        let home = crate::codex_home::gui_home(request.app)?;
        let catalog = crate::codex_gui::cached_catalog(&home).map_err(|error| error.to_string())?;
        return super::gui_context::model_catalog(json_payload(200, catalog), |_| Ok(()));
    }
    let catalog_url = catalog_url(request.url, || {
        Ok(crate::official_models::model_client_version(
            &resolve_paths(request.app)?,
        ))
    })?;
    let payload = forward_active_request(ActiveForwardRequest {
        app: request.app,
        method: request.method,
        url: &catalog_url,
        headers: &unconditional_model_catalog_headers(request.headers),
        body: Vec::new(),
        target,
        session_id: None,
        account_id_override: account_id,
    })?;
    super::gui_context::model_catalog(payload, |catalog| {
        crate::codex_gui::model_context::prepare_catalog(request.app, catalog, true)
            .map_err(|error| error.to_string())
    })
}

fn catalog_url(
    url: &str,
    version: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    let mut parsed =
        url::Url::parse(&format!("http://localhost{url}")).map_err(|error| error.to_string())?;
    if !parsed
        .query_pairs()
        .any(|(key, value)| key == "client_version" && !value.is_empty())
    {
        let pairs: Vec<_> = parsed
            .query_pairs()
            .filter(|(key, _)| key != "client_version")
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        parsed.set_query(None);
        parsed
            .query_pairs_mut()
            .extend_pairs(pairs)
            .append_pair("client_version", &version()?);
    }
    Ok(format!(
        "{}?{}",
        parsed.path(),
        parsed.query().unwrap_or_default()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passive_cli_discovery_uses_only_gui_cache_without_account_credentials() {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("com.codex-switch.catalog-test.{}", uuid::Uuid::new_v4());
        let app = tauri::test::mock_builder().build(context).unwrap();
        app.manage(crate::codex_gui::GuiState::default());
        let home = crate::codex_home::gui_home(app.handle()).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        let path = home.join("models_cache.json");
        let cached = json!({"models": [{"slug": "cached", "visibility": "list"}]});
        std::fs::write(&path, serde_json::to_vec(&cached).unwrap()).unwrap();
        let request = GuiProxyRequest {
            app: app.handle(),
            method: &Method::Get,
            url: "/v1/models",
            headers: &[],
            body: Vec::new(),
            session_id: None,
            session_request_id: None,
        };
        let target = ActiveTarget::Official {
            model: "cached".into(),
        };
        let mut payload = models(&request, &target, None).unwrap();
        let bytes = read_official_model_catalog_body(&mut payload.body).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap()["models"][0]["slug"],
            "cached"
        );
        std::fs::remove_file(path).unwrap();
        assert!(models(&request, &target, None).is_err());
    }

    #[test]
    fn catalog_requests_supply_required_version_without_replacing_cli_queries() {
        assert_eq!(
            catalog_url("/v1/models", || Ok("0.162.1".into())).unwrap(),
            "/v1/models?client_version=0.162.1"
        );
        assert_eq!(
            catalog_url("/v1/models?client_version=&x=1", || Ok("0.162.1".into())).unwrap(),
            "/v1/models?x=1&client_version=0.162.1"
        );
        assert_eq!(
            catalog_url("/v1/models?client_version=0.170.0&x=1", || panic!(
                "already supplied"
            ))
            .unwrap(),
            "/v1/models?client_version=0.170.0&x=1"
        );
    }

    #[test]
    fn scopes_only_gui_urls_and_preserves_queries() {
        assert_eq!(
            upstream_path("/codex-gui/v1/models?client_version=1"),
            Some("/v1/models?client_version=1")
        );
        assert_eq!(request_path("/codex-gui/v1/responses?x=1"), "/v1/responses");
        assert_eq!(upstream_path("/v1/responses"), None);
        assert_eq!(upstream_path("/codex-gui-other/v1/responses"), None);
    }
}
