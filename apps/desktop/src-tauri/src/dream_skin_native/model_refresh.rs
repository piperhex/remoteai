#[cfg(test)]
const CODEX_MODEL_QUERY_PREFIX: [&str; 2] = ["models", "list"];
// Codex Desktop keys an unauthenticated model query with authMethod ?? "no-auth".
// Seeding that exact cache entry lets a picker mounted after this refresh reuse the injected models.
const CODEX_MODEL_QUERY_HOST: &str = "local";
const CODEX_MODEL_QUERY_NO_AUTH: &str = "no-auth";
const CODEX_MODEL_QUERY_LIMIT: u16 = 100;
const CODEX_COMPOSER_STATUS_ALLOWED_GLOBAL: &str = "__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__";
const CODEX_COMPOSER_STATUS_OBSERVER_GLOBAL: &str = "__CODEX_SWITCH_COMPOSER_STATUS_OBSERVER__";

/// Outcome reported by the Codex renderer after refreshing its model cache.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CodexModelRefreshResult {
    pub(crate) refreshed: bool,
    pub(crate) reason: Option<String>,
}

fn codex_model_fallback_query_key() -> Value {
    json!([
        "models",
        "list",
        CODEX_MODEL_QUERY_HOST,
        CODEX_MODEL_QUERY_NO_AUTH,
        CODEX_MODEL_QUERY_LIMIT,
    ])
}

const CODEX_MODEL_OBSERVER_PATCH_HELPERS: &str = r#"
  const patchStateKey = "__CODEX_SWITCH_MODEL_QUERY_PATCH__";
  const queryPatchSymbol = Symbol.for("codex-switch.models.query-patch");
  const observerPatchSymbol = Symbol.for("codex-switch.models.observer-patch");
  const wrappedSelectSymbol = Symbol.for("codex-switch.models.wrapped-select");
  const restoreObserver = observer => {
    const patch = observer?.[observerPatchSymbol];
    if (!patch) return;
    patch.originalSetOptions({ ...observer.options, select: patch.originalSelect });
    delete observer.setOptions;
    delete observer[observerPatchSymbol];
  };
  const restoreQuery = query => {
    for (const observer of query?.observers ?? []) restoreObserver(observer);
    if (!query?.[queryPatchSymbol]) return;
    delete query.addObserver;
    delete query[queryPatchSymbol];
  };
  const clearModelQueryPatch = () => {
    const state = window[patchStateKey];
    if (!state) return;
    state.unsubscribe?.();
    for (const query of state.queries ?? []) restoreQuery(query);
    delete window[patchStateKey];
  };
  const wrapSelect = originalSelect => {
    const wrappedSelect = input => {
      const base = typeof originalSelect === "function" ? originalSelect(input) : input;
      const state = window[patchStateKey];
      if (!state?.active || !Array.isArray(state.models)) return base;
      const models = state.models;
      const supportsEffort = effort => models.some(model =>
        model.supportedReasoningEfforts?.some(item => item.reasoningEffort === effort)
      );
      return {
        ...(base && typeof base === "object" ? base : {}),
        models,
        defaultModel: models.find(model => model.isDefault) ?? models[0] ?? null,
        hasModelSupportingMaxReasoningEffort: supportsEffort("max"),
        hasModelSupportingUltraReasoningEffort: supportsEffort("ultra"),
      };
    };
    wrappedSelect[wrappedSelectSymbol] = true;
    return wrappedSelect;
  };
  const patchObserver = observer => {
    if (!observer || typeof observer.setOptions !== "function") return;
    let patch = observer[observerPatchSymbol];
    if (!patch) {
      patch = {
        originalSelect: observer.options?.select ?? null,
        originalSetOptions: observer.setOptions.bind(observer),
      };
      observer[observerPatchSymbol] = patch;
      observer.setOptions = options => {
        if (!options?.select?.[wrappedSelectSymbol]) {
          patch.originalSelect = options?.select ?? null;
        }
        return patch.originalSetOptions({
          ...options,
          select: wrapSelect(patch.originalSelect),
        });
      };
    }
    observer.setOptions(observer.options);
  };
  const patchQuery = query => {
    if (!matchesModelsQuery(query)) return;
    patchState.queries.add(query);
    if (!query[queryPatchSymbol]) {
      const originalAddObserver = query.addObserver.bind(query);
      query[queryPatchSymbol] = { originalAddObserver };
      query.addObserver = observer => {
        const result = originalAddObserver(observer);
        patchObserver(observer);
        return result;
      };
    }
    for (const observer of query.observers ?? []) patchObserver(observer);
  };
"#;

fn codex_model_refresh_expression(
    models: &[String],
    fast_mode_models: &[String],
    image_input_models: &[String],
    model_reasoning_efforts: &crate::models::ModelReasoningEfforts,
    selected_model: &str,
    reasoning_profile: crate::providers::ReasoningEffortProfile,
) -> Result<String, String> {
    let mut default_reasoning_efforts = Map::new();
    let reasoning_efforts = models
        .iter()
        .map(|model| {
            let profile =
                crate::providers::reasoning_effort_profile_for_model(model, reasoning_profile);
            let efforts = crate::providers::supported_reasoning_levels_for_model(
                model,
                profile,
                model_reasoning_efforts,
            );
            default_reasoning_efforts.insert(
                model.clone(),
                json!(crate::providers::default_reasoning_level(&efforts)),
            );
            let efforts = efforts
                .as_array()
                .into_iter()
                .flatten()
                .map(|level| {
                    json!({
                        "reasoningEffort": level["effort"],
                        "description": level["description"],
                    })
                })
                .collect::<Vec<_>>();
            (model.clone(), Value::Array(efforts))
        })
        .collect::<Map<String, Value>>();
    let default_reasoning_efforts = Value::Object(default_reasoning_efforts);
    let models = serde_json::to_string(models)
        .map_err(|error| format!("Failed to prepare the Codex model list: {error}"))?;
    let fast_mode_models = serde_json::to_string(fast_mode_models)
        .map_err(|error| format!("Failed to prepare Fast-capable models: {error}"))?;
    let image_input_models = serde_json::to_string(image_input_models)
        .map_err(|error| format!("Failed to prepare image-capable models: {error}"))?;
    let selected_model = serde_json::to_string(selected_model)
        .map_err(|error| format!("Failed to prepare the selected Codex model: {error}"))?;
    let reasoning_efforts = serde_json::to_string(&reasoning_efforts)
        .map_err(|error| format!("Failed to prepare reasoning efforts: {error}"))?;
    let fallback_query_key = serde_json::to_string(&codex_model_fallback_query_key())
        .map_err(|error| format!("Failed to prepare the fallback model query: {error}"))?;
    let observer_patch_helpers = CODEX_MODEL_OBSERVER_PATCH_HELPERS;
    let service_tier = serde_json::to_string(crate::local_proxy::proxy_service_tier_name())
        .map_err(|error| format!("Failed to prepare the proxy service tier: {error}"))?;
    let speed_selector_overlay =
        CODEX_SPEED_SELECTOR_OVERLAY.replace("__CODEX_SWITCH_SERVICE_TIER__", &service_tier);
    let composer_status_allowed_global = CODEX_COMPOSER_STATUS_ALLOWED_GLOBAL;
    let composer_status_observer_global = CODEX_COMPOSER_STATUS_OBSERVER_GLOBAL;
    let context_usage_overlay = context_usage_overlay_expression(crate::local_proxy::is_running());
    Ok(format!(
        r#"(async () => {{
  // A timed-out CDP call leaves its renderer promise alive, so newer refreshes must supersede it here.
  const refreshSequenceKey = "__CODEX_SWITCH_MODEL_REFRESH_SEQUENCE__";
  const refreshSequence = (window[refreshSequenceKey] ?? 0) + 1;
  window[refreshSequenceKey] = refreshSequence;
  const isCurrentRefresh = () => window[refreshSequenceKey] === refreshSequence;
  const supersededRefresh = {{ refreshed: false, reason: "superseded-model-refresh" }};
  const expectedModels = {models};
  const fastModeModels = new Set({fast_mode_models});
  const imageInputModels = new Set({image_input_models});
  const selectedModel = {selected_model};
  const supportedReasoningEffortsByModel = {reasoning_efforts};
  const defaultReasoningEffortsByModel = {default_reasoning_efforts};
{context_usage_overlay}
  const root = window.__codexRoot;
  if (!root || !Array.isArray(expectedModels)) {{
    return {{ refreshed: false, reason: "unavailable" }};
  }}
  const queue = [root._internalRoot?.current ?? root];
  const seen = new Set();
  let queryClient = null;
  while (queue.length && seen.size < 50000) {{
    const fiber = queue.shift();
    if (!fiber || typeof fiber !== "object" || seen.has(fiber)) continue;
    seen.add(fiber);
    const candidates = [
      fiber.memoizedProps?.client,
      fiber.pendingProps?.client,
      fiber.memoizedState?.client,
    ];
    queryClient = candidates.find(candidate =>
      candidate && typeof candidate.getQueryCache === "function" &&
      typeof candidate.invalidateQueries === "function" &&
      typeof candidate.setQueryData === "function"
    ) ?? null;
    if (queryClient) break;
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }}
  if (!queryClient) return {{ refreshed: false, reason: "query-client-not-found" }};

  const matchesModelsQuery = query => Array.isArray(query?.queryKey) &&
    query.queryKey[0] === "models" && query.queryKey[1] === "list";
  const matchesConfigQuery = query => Array.isArray(query.queryKey) && (
    query.queryKey[0] === "user-saved-config" ||
    (query.queryKey[0] === "config" &&
      (query.queryKey[1] === "user" || query.queryKey[1] === "read-response"))
  );
  const hasActiveLocalModelQuery = (authMethod = null) => queryClient.getQueryCache().getAll().some(query => {{
    const key = query.queryKey;
    const active = typeof query.isActive === "function"
      ? query.isActive()
      : (query.observers?.length ?? 0) > 0;
    return active && matchesModelsQuery(query) && key[2] === "local" &&
      (authMethod === null || key[3] === authMethod);
  }});
  const syncComposerStatus = () => {{
    // Daily usage is independent of login mode; authenticated Codex owns its native Fast control.
    const allowed = hasActiveLocalModelQuery();
    const fastModeAllowed = fastModeModels.size > 0 && hasActiveLocalModelQuery("no-auth");
    const changed = window.{composer_status_allowed_global} !== allowed ||
      window.__CODEX_SWITCH_FAST_MODE_ALLOWED__ !== fastModeAllowed;
    window.{composer_status_allowed_global} = allowed;
    window.__CODEX_SWITCH_FAST_MODE_ALLOWED__ = fastModeAllowed;
    if (changed) window.__CODEX_SWITCH_REFRESH_SPEED_SELECTOR__?.();
  }};
  syncComposerStatus();
{speed_selector_overlay}
{observer_patch_helpers}
  window.{composer_status_observer_global}?.unsubscribe?.();
  window.{composer_status_observer_global} = {{
    unsubscribe: queryClient.getQueryCache().subscribe(event => {{
      if (matchesModelsQuery(event?.query)) syncComposerStatus();
    }}),
  }};
  syncComposerStatus();
  if (expectedModels.length === 0) {{
    clearModelQueryPatch();
    // Inactive picker queries retain injected Provider data after invalidation, so reset their
    // cached data before returning to the official catalog.
    if (typeof queryClient.resetQueries === "function") {{
      await queryClient.resetQueries({{ predicate: matchesModelsQuery }}, {{ cancelRefetch: true }});
    }} else {{
      await queryClient.invalidateQueries({{
        predicate: matchesModelsQuery,
        refetchType: "all",
      }});
    }}
    if (!isCurrentRefresh()) return supersededRefresh;
    await queryClient.invalidateQueries({{
      predicate: matchesConfigQuery,
      refetchType: "active",
    }});
    if (!isCurrentRefresh()) return supersededRefresh;
    const currentQueries = queryClient.getQueryCache().getAll().filter(matchesModelsQuery);
    return {{
      refreshed: currentQueries.length > 0,
      reason: currentQueries.length > 0 ? "official-model-queries-reset" : "models-query-not-found",
      injected: false,
      count: 0,
    }};
  }}
  await queryClient.invalidateQueries({{
    predicate: query => matchesModelsQuery(query) || matchesConfigQuery(query),
    refetchType: "active",
  }});
  if (!isCurrentRefresh()) return supersededRefresh;

  const currentQueries = queryClient.getQueryCache().getAll().filter(matchesModelsQuery);
  const expected = new Set(expectedModels);
  const injectedModels = expectedModels.map((model, index) => ({{
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model === "codex switch control" ? "Remote AI Control" : model,
    description: model,
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: supportedReasoningEffortsByModel[model] ?? [],
    defaultReasoningEffort: defaultReasoningEffortsByModel[model],
    inputModalities: imageInputModels.has(model) ? ["text", "image"] : ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: fastModeModels.has(model) ? ["fast"] : [],
    serviceTiers: fastModeModels.has(model)
      ? [{{ id: "priority", name: "Fast", description: "Faster responses with increased usage" }}]
      : [],
    defaultServiceTier: fastModeModels.has(model) ? "default" : null,
    isDefault: model === selectedModel || (!expected.has(selectedModel) && index === 0),
  }}));
  const previousPatchState = window[patchStateKey];
  if (previousPatchState?.queryClient && previousPatchState.queryClient !== queryClient) {{
    clearModelQueryPatch();
  }}
  const patchState = window[patchStateKey] ?? {{
    active: true,
    models: [],
    queries: new Set(),
    queryClient,
    unsubscribe: null,
  }};
  patchState.active = true;
  patchState.models = injectedModels;
  patchState.queryClient = queryClient;
  window[patchStateKey] = patchState;
  patchState.unsubscribe?.();
  patchState.unsubscribe = queryClient.getQueryCache().subscribe(event => {{
    if (event?.type === "added") patchQuery(event.query);
  }});
  for (const query of currentQueries) patchQuery(query);
  const targetQueryKeys = currentQueries.length > 0
    ? currentQueries.map(query => query.queryKey)
    : [{fallback_query_key}];
  let injected = false;
  for (const queryKey of targetQueryKeys) {{
    queryClient.setQueryData(queryKey, current => {{
      const currentModels = Array.isArray(current?.data) ? current.data : [];
      const currentIds = currentModels.map(model => model?.model ?? model?.id).filter(Boolean);
      const containsExpectedModels = expectedModels.every(model => currentIds.includes(model));
      const visibleCurrentModels = currentModels.filter(model =>
        expected.has(model?.model ?? model?.id)
      );
      if (!containsExpectedModels || currentIds.length !== expectedModels.length) injected = true;
      const data = containsExpectedModels
        ? visibleCurrentModels.map((model, index) => ({{
            ...model,
            additionalSpeedTiers: fastModeModels.has(model.model ?? model.id) ? ["fast"] : [],
            serviceTiers: fastModeModels.has(model.model ?? model.id)
              ? [{{ id: "priority", name: "Fast", description: "Faster responses with increased usage" }}]
              : [],
            defaultServiceTier: fastModeModels.has(model.model ?? model.id) ? "default" : null,
            inputModalities: imageInputModels.has(model.model ?? model.id)
              ? ["text", "image"]
              : ["text"],
            displayName: (model.model ?? model.id) === "codex switch control"
              ? "Remote AI Control"
              : model.displayName,
            isDefault: (model.model ?? model.id) === selectedModel ||
              (!expected.has(selectedModel) && index === 0),
          }}))
        : injectedModels;
      return {{
        ...(current && typeof current === "object" ? current : {{}}),
        data,
        nextCursor: null,
      }};
    }});
  }}
  for (const query of queryClient.getQueryCache().getAll().filter(matchesModelsQuery)) {{
    patchQuery(query);
  }}
  const patchedObservers = [...patchState.queries]
    .flatMap(query => query.observers ?? [])
    .filter(observer => Boolean(observer[observerPatchSymbol])).length;
  return {{
    refreshed: true,
    reason: currentQueries.length > 0
      ? "existing-model-queries-refreshed"
      : "no-auth-model-query-created",
    queryKeys: targetQueryKeys,
    injected,
    count: injectedModels.length,
    patchedObservers,
  }};
}})()"#
    ))
}
