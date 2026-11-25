fn initialize_store() -> Result<(), String> {
    let state = state_root()?;
    ensure_directory(&state)?;
    ensure_directory(&active_theme_root()?)?;
    ensure_directory(&themes_root()?)?;
    let active = load_theme(&active_theme_root()?).ok();
    let retired_active = active.as_ref().is_some_and(|theme| {
        theme
            .document
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| RETIRED_THEME_IDS.contains(&id))
    });
    if active.is_none() || retired_active {
        if let Ok(root) = crate::dream_skin_resources::installed_pack_root() {
            copy_theme_to_active(&built_in_theme_directory(&root, "preset-rose-reverie")?)?;
        }
    }
    Ok(())
}

fn load_payload(paths: &RuntimePaths) -> Result<LoadedPayload, String> {
    let theme = load_theme(&active_theme_root()?)?;
    #[cfg(target_os = "windows")]
    let platform = "windows";
    #[cfg(target_os = "macos")]
    let platform = "macos";
    let assets = paths.bundled_root.join("assets").join(platform);
    let css = fs::read_to_string(assets.join("dream-skin.css"))
        .map_err(|error| format!("Failed to read Dream Skin CSS: {error}"))?;
    let template = fs::read_to_string(assets.join("renderer-inject.js"))
        .map_err(|error| format!("Failed to read Dream Skin renderer: {error}"))?;
    let art_data_url = format!(
        "data:{};base64,{}",
        theme.mime,
        BASE64.encode(&theme.image_bytes)
    );
    render_payload(&template, &css, &art_data_url, &theme.document)
}

#[cfg(target_os = "windows")]
fn render_payload(
    template: &str,
    css: &str,
    art_data_url: &str,
    theme: &Value,
) -> Result<LoadedPayload, String> {
    let css_json = serde_json::to_string(&css).map_err(|error| error.to_string())?;
    let art_json = serde_json::to_string(&art_data_url).map_err(|error| error.to_string())?;
    let theme_json = serde_json::to_string(theme).map_err(|error| error.to_string())?;
    let version_json = serde_json::to_string(SKIN_VERSION).map_err(|error| error.to_string())?;
    let source = template
        .replace("__DREAM_CSS_JSON__", &css_json)
        .replace("__DREAM_ART_JSON__", &art_json)
        .replace("__DREAM_THEME_JSON__", &theme_json)
        .replace("__DREAM_SKIN_VERSION_JSON__", &version_json);
    if source.contains("__DREAM_CSS_JSON__")
        || source.contains("__DREAM_ART_JSON__")
        || source.contains("__DREAM_THEME_JSON__")
        || source.contains("__DREAM_SKIN_VERSION_JSON__")
    {
        return Err("Dream Skin renderer template contains unresolved placeholders.".to_string());
    }
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    let revision = format!("{:x}", hasher.finalize());
    Ok(LoadedPayload { source, revision })
}

#[cfg(target_os = "macos")]
fn render_payload(
    template: &str,
    css: &str,
    art_data_url: &str,
    theme: &Value,
) -> Result<LoadedPayload, String> {
    let css_json = serde_json::to_string(&css).map_err(|error| error.to_string())?;
    let art_json = serde_json::to_string(&art_data_url).map_err(|error| error.to_string())?;
    let theme_json = serde_json::to_string(theme).map_err(|error| error.to_string())?;

    let mut style_hasher = Sha256::new();
    // Renderer compatibility rewrites are part of the effective stylesheet.
    // Include the renderer and version so an already-open window refreshes
    // when those rewrites change even if the raw CSS file does not.
    style_hasher.update(SKIN_VERSION.as_bytes());
    style_hasher.update(css.as_bytes());
    style_hasher.update(template.as_bytes());
    let style_revision = format!("{:x}", style_hasher.finalize())[..20].to_string();

    let mut payload_hasher = Sha256::new();
    payload_hasher.update(SKIN_VERSION.as_bytes());
    payload_hasher.update(css.as_bytes());
    payload_hasher.update(template.as_bytes());
    payload_hasher.update(theme_json.as_bytes());
    let revision = format!("{:x}", payload_hasher.finalize())[..20].to_string();

    let version_json = serde_json::to_string(SKIN_VERSION).map_err(|error| error.to_string())?;
    let style_revision_json =
        serde_json::to_string(&style_revision).map_err(|error| error.to_string())?;
    let revision_json = serde_json::to_string(&revision).map_err(|error| error.to_string())?;
    let replacements = [
        ("__DREAM_SKIN_CSS_JSON__", css_json.as_str()),
        ("__DREAM_SKIN_ART_JSON__", art_json.as_str()),
        ("__DREAM_SKIN_THEME_JSON__", theme_json.as_str()),
        ("__DREAM_SKIN_VERSION_JSON__", version_json.as_str()),
        (
            "__DREAM_SKIN_STYLE_REVISION_JSON__",
            style_revision_json.as_str(),
        ),
        (
            "__DREAM_SKIN_PAYLOAD_REVISION_JSON__",
            revision_json.as_str(),
        ),
    ];
    let mut source = template.to_string();
    for (placeholder, value) in replacements {
        source = source.replace(placeholder, value);
    }
    if replacements
        .iter()
        .any(|(placeholder, _)| source.contains(placeholder))
    {
        return Err("Dream Skin renderer template contains unresolved placeholders.".to_string());
    }
    Ok(LoadedPayload { source, revision })
}

fn early_payload(payload: &LoadedPayload) -> String {
    include_str!("early_injection.js")
        .replace(
            "__DREAM_SKIN_GENERATION_JSON__",
            &json!(payload.revision).to_string(),
        )
        .replace("__DREAM_SKIN_SOURCE__", &payload.source)
}

const REMOVE_PAYLOAD: &str = r#"(() => {
  window.__CODEX_DREAM_SKIN_DISABLED__ = true;
  if (typeof window.__CODEX_DREAM_SKIN_EARLY_STOP__ === 'function') window.__CODEX_DREAM_SKIN_EARLY_STOP__();
  const state = window.__CODEX_DREAM_SKIN_STATE__;
  if (state?.cleanup) return state.cleanup();
  document.documentElement?.classList.remove(
    'codex-dream-skin', 'dream-theme-light', 'dream-theme-dark',
    'dream-art-wide', 'dream-art-standard', 'dream-focus-left',
    'dream-focus-center', 'dream-focus-right', 'dream-safe-left',
    'dream-safe-center', 'dream-safe-right', 'dream-safe-none',
    'dream-task-ambient', 'dream-task-banner', 'dream-task-off'
  );
  for (const property of [
    '--dream-art', '--dream-art-position', '--dream-focus-x', '--dream-focus-y',
    '--dream-accent', '--dream-accent-ink', '--dream-image-luma'
  ]) document.documentElement?.style.removeProperty(property);
  document.querySelectorAll('.dream-home,.dream-task,.dream-home-shell').forEach((node) => {
    node.classList.remove('dream-home', 'dream-task', 'dream-home-shell');
  });
  document.getElementById('codex-dream-skin-style')?.remove();
  document.getElementById('codex-dream-skin-chrome')?.remove();
  delete window.__CODEX_DREAM_SKIN_STATE__;
  return true;
})()"#;

const VERIFY_PAYLOAD: &str = r#"(() => {
  const settingsPresent = Boolean(document.querySelector(
    '[data-settings-panel-slug="general-settings"], input[name="appearance-theme"], [data-testid="theme-preview"]'
  ));
  const result = {
    installed: document.documentElement.classList.contains('codex-dream-skin'),
    version: window.__CODEX_DREAM_SKIN_STATE__?.version ?? null,
    expectedVersion: '1.2.3',
    revision: window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ ?? null,
    stylePresent: Boolean(document.getElementById('codex-dream-skin-style')),
    chromePresent: Boolean(document.getElementById('codex-dream-skin-chrome')),
    shellPresent: Boolean(document.querySelector(
      'main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])'
    )),
    sidebarPresent: Boolean(document.querySelector('aside.app-shell-left-panel')),
    titlebarPresent: Boolean(document.querySelector('main[data-app-shell-main-surface]')
      ?.closest('[data-app-shell-frame]')?.querySelector('header[data-app-shell-titlebar]')),
    composerPresent: Boolean(document.querySelector(
      '.composer-surface-chrome, [data-codex-composer-root] [data-composer-layout][data-composer-surface-variant]'
    )),
    settingsPresent,
  };
  // Composer markup is route- and version-dependent. Codex 26.803 replaced
  // .composer-surface-chrome with semantic data attributes, and some valid
  // detail routes have no composer at all. Verify the stable shell instead.
  const primarySurface = result.chromePresent && result.shellPresent && (result.sidebarPresent || result.titlebarPresent);
  result.pass = result.installed && result.version === result.expectedVersion &&
    result.stylePresent && (primarySurface || result.settingsPresent);
  return result;
})()"#;

const CODEX_PROBE_PAYLOAD: &str = concat!(
    r#"(() => ({
  codex: location.protocol === 'app:' && Boolean(
    (document.querySelector('main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])') &&
      (document.querySelector('aside.app-shell-left-panel') ||
        document.querySelector('main[data-app-shell-main-surface]')?.closest('[data-app-shell-frame]')
          ?.querySelector('header[data-app-shell-titlebar]'))) ||
    document.querySelector('[data-settings-panel-slug="general-settings"], "#,
    r#"input[name="appearance-theme"], [data-testid="theme-preview"]')
  )
}))()"#
);
