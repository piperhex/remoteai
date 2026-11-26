use tauri::{webview::WebviewBuilder, AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Keeps dynamically created windows compatible with the main window's WebView2 environment.
/// Call `build` from an async command or worker, never from a Windows UI event handler.
pub(crate) fn builder<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    label: &str,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let builder = WebviewWindowBuilder::new(app, label, url);
    // WebViews sharing a data directory must use identical browser arguments; otherwise
    // WebView2 rejects the new controller with ERROR_INVALID_STATE (0x8007139f).
    match browser_arguments(app.config()) {
        Some(arguments) => builder.additional_browser_args(arguments),
        None => builder,
    }
}

/// Child previews share the main WebView2 environment just like auxiliary windows.
/// Create them from an async command or worker to keep the Windows message loop responsive.
pub(crate) fn child_builder<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: WebviewUrl,
) -> WebviewBuilder<R> {
    let builder = WebviewBuilder::new(label, url);
    match browser_arguments(app.config()) {
        Some(arguments) => builder.additional_browser_args(arguments),
        None => builder,
    }
}

pub(crate) fn browser_arguments(config: &tauri::Config) -> Option<&str> {
    config
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.as_deref())
}

#[cfg(test)]
mod tests {
    use super::browser_arguments;
    use tauri::{utils::config::WindowConfig, Config};

    #[test]
    fn auxiliary_windows_inherit_the_exact_main_browser_arguments() {
        let mut config: Config = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let expected = config.app.windows[0]
            .additional_browser_args
            .clone()
            .unwrap();
        config.app.windows.insert(
            0,
            WindowConfig {
                label: "another-window".into(),
                additional_browser_args: Some("--different-options".into()),
                ..Default::default()
            },
        );

        assert_eq!(browser_arguments(&config), Some(expected.as_str()));
    }

    #[test]
    fn absent_browser_arguments_preserve_runtime_defaults() {
        let mut config = Config::default();
        assert_eq!(browser_arguments(&config), None);

        config.app.windows.push(WindowConfig::default());
        assert_eq!(browser_arguments(&config), None);
    }
}
