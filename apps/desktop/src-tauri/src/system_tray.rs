mod copy;
use copy::floating_bubble_toggle_label;
#[cfg(any(not(windows), test))]
use copy::initial_menu_labels;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime,
};

use crate::{commands, models::ProviderSummary, providers, storage::read_app_settings};

mod account_label;
mod account_menu;
mod localization;
#[cfg(windows)]
pub(crate) mod lounge;
#[cfg(windows)]
pub(crate) mod quick_menu;
#[cfg(not(windows))]
mod refresh;
#[cfg(windows)]
pub(crate) mod windows_menu;

#[cfg(not(windows))]
pub(crate) use refresh::refresh_menu;

#[cfg(windows)]
pub(crate) fn refresh_menu<R: Runtime>(_app: &AppHandle<R>) {
    // The glass menu reads a fresh snapshot whenever it opens.
}

const TRAY_ID: &str = "main-tray";
const DASHBOARD_ID: &str = "tray:dashboard";
const FLOATING_BUBBLE_TOGGLE_ID: &str = "tray:toggle-floating-bubble";
const SETTINGS_ID: &str = "tray:settings";
const OPEN_SETTINGS_EVENT: &str = "open-settings";
const RESTART_CHATGPT_ID: &str = "tray:restart-chatgpt";
const RESTART_APP_ID: &str = "tray:restart-app";
const QUIT_ID: &str = "tray:quit";
const ACCOUNT_PREFIX: &str = "tray:account:";
const PROVIDER_PREFIX: &str = "tray:provider:";
const PROVIDER_MODEL_PREFIX: &str = "tray:provider-model:";
const PROVIDER_SUBMENU_PREFIX: &str = "tray:provider-submenu:";
const MENU_PROVIDER_CHARS: usize = 28;

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(windows))]
    let menu = build_initial_menu(app.handle())?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Remote AI")
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            #[cfg(windows)]
            match &event {
                TrayIconEvent::Enter { rect, .. } | TrayIconEvent::Move { rect, .. } => {
                    lounge::hover(tray, *rect)
                }
                TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClick { .. } => {
                    lounge::dismiss(tray)
                }
                _ => {}
            }
            #[cfg(windows)]
            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: tauri::tray::MouseButtonState::Up,
                position,
                ..
            } = &event
            {
                let app = tray.app_handle().clone();
                let position = *position;
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = quick_menu::show(&app, position).await {
                        eprintln!("failed to open tray menu: {error}");
                    }
                });
            }
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_dashboard(tray.app_handle());
            }
        });
    #[cfg(not(windows))]
    {
        builder = builder.menu(&menu);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::include_image!("icons/tray-black.png"))
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.icon(tauri::include_image!("icons/32x32.png"));
    }

    let tray = builder.build(app)?;
    #[cfg(windows)]
    windows_menu::install_for_tray(&tray).map_err(std::io::Error::other)?;
    #[cfg(windows)]
    lounge::start(&tray);
    #[cfg(not(windows))]
    let _ = tray;
    refresh_menu(app.handle());
    Ok(())
}

#[cfg(not(windows))]
fn build_initial_menu<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;
    let settings = read_app_settings(app).ok();
    let (dashboard, loading, quit) = initial_menu_labels(
        settings
            .as_ref()
            .and_then(|value| value.language.as_deref()),
    );
    menu.append(&MenuItem::with_id(
        app,
        DASHBOARD_ID,
        dashboard,
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "tray:loading",
        loading,
        false,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(app, QUIT_ID, quit, true, None::<&str>)?)?;
    Ok(menu)
}

pub(crate) fn show_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_window("main") {
        #[cfg(target_os = "macos")]
        crate::main_window::reset_to_default_size(app);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn show_settings<R: Runtime>(app: &AppHandle<R>) {
    show_dashboard(app);
    let Some(window) = app.get_webview("main") else {
        return;
    };
    if let Err(error) = window.emit(OPEN_SETTINGS_EVENT, ()) {
        eprintln!("failed to open settings from menu: {error}");
    }
}

pub(crate) fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == FLOATING_BUBBLE_TOGGLE_ID {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = crate::floating_bubble::toggle_floating_bubble(app).await {
                eprintln!("failed to toggle floating usage window from menu: {error}");
            }
        });
        return;
    }
    if id == SETTINGS_ID {
        show_settings(app);
        return;
    }
    if id == DASHBOARD_ID {
        show_dashboard(app);
        return;
    }
    if id == RESTART_CHATGPT_ID {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = commands::restart_chatgpt_blocking(app) {
                eprintln!("failed to restart ChatGPT from menu: {error}");
            }
        });
        return;
    }
    if id == RESTART_APP_ID {
        app.request_restart();
        return;
    }
    if id == QUIT_ID {
        app.exit(0);
        return;
    }
    if let Some(account_id) = id.strip_prefix(ACCOUNT_PREFIX) {
        let app = app.clone();
        let account_id = account_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) =
                commands::switch_account_and_restart_chatgpt_blocking(app, account_id)
            {
                eprintln!("failed to switch account from tray: {error}");
            }
        });
        return;
    }
    if let Some(selection) = parse_provider_model_menu_id(id) {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = providers::switch_provider_model_and_activate_blocking(
                app,
                selection.provider_id,
                selection.model,
            ) {
                eprintln!("failed to switch provider model from menu: {error}");
            }
        });
        return;
    }
    if let Some(provider_id) = id.strip_prefix(PROVIDER_PREFIX) {
        let app = app.clone();
        let provider_id = provider_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(error) = providers::switch_provider_blocking(app, provider_id) {
                eprintln!("failed to switch provider from tray: {error}");
            }
        });
    }
}

pub(crate) fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let menu = Menu::new(app)?;
    let settings = read_app_settings(app).ok();
    let chinese = settings
        .as_ref()
        .and_then(|settings| settings.language.as_deref())
        == Some("zh");
    let floating_bubble_enabled = settings
        .as_ref()
        .map(|settings| settings.floating_bubble_enabled)
        .unwrap_or_else(|| {
            app.get_webview_window(crate::floating_bubble::BUBBLE_LABEL)
                .is_some()
        });

    let accounts_header = MenuItem::with_id(
        app,
        "tray:accounts-header",
        copy::text(chinese, copy::Text::Accounts),
        false,
        None::<&str>,
    )?;
    menu.append(&accounts_header)?;

    account_menu::append_accounts(app, &menu, settings.as_ref(), chinese)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    append_provider_items(app, &menu, chinese)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        FLOATING_BUBBLE_TOGGLE_ID,
        floating_bubble_toggle_label(chinese, floating_bubble_enabled),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        SETTINGS_ID,
        copy::text(chinese, copy::Text::Settings),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        DASHBOARD_ID,
        copy::text(chinese, copy::Text::Dashboard),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        RESTART_CHATGPT_ID,
        copy::text(chinese, copy::Text::RestartChatGPT),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        RESTART_APP_ID,
        copy::text(chinese, copy::Text::RestartRemoteAI),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        copy::text(chinese, copy::Text::Quit),
        true,
        None::<&str>,
    )?)?;
    localization::localize(
        &menu,
        settings
            .as_ref()
            .and_then(|settings| settings.language.as_deref()),
        floating_bubble_enabled,
    )?;
    Ok(menu)
}

fn append_provider_items<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    chinese: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let header = MenuItem::with_id(
        app,
        "tray:providers-header",
        copy::text(chinese, copy::Text::Providers),
        false,
        None::<&str>,
    )?;
    menu.append(&header)?;

    match providers::list_providers_blocking(app.clone()) {
        Ok(providers) => {
            if providers.is_empty() {
                let empty = MenuItem::with_id(
                    app,
                    "tray:providers-empty",
                    copy::text(chinese, copy::Text::NoProviders),
                    false,
                    None::<&str>,
                )?;
                menu.append(&empty)?;
                return Ok(());
            }

            for provider in providers {
                append_provider_item(app, menu, &provider)?;
            }
        }
        Err(error) => {
            eprintln!("failed to read providers for menu: {error}");
            let item = MenuItem::with_id(
                app,
                "tray:providers-error",
                copy::text(chinese, copy::Text::UnableToLoadProviders),
                false,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }
    Ok(())
}

fn append_provider_item<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    provider: &ProviderSummary,
) -> Result<(), Box<dyn std::error::Error>> {
    if provider.model_selection_controlled_by_codex || provider.models.is_empty() {
        let item = CheckMenuItem::with_id(
            app,
            format!("{PROVIDER_PREFIX}{}", provider.id),
            provider_label(provider),
            provider.supports_direct_switch,
            provider.active,
            None::<&str>,
        )?;
        menu.append(&item)?;
        return Ok(());
    }

    let submenu = Submenu::with_id(
        app,
        format!("{PROVIDER_SUBMENU_PREFIX}{}", provider.id),
        provider_submenu_label(provider),
        provider.supports_direct_switch,
    )?;
    for model in &provider.models {
        let item = CheckMenuItem::with_id(
            app,
            provider_model_menu_id(&provider.id, model),
            escape_menu_text(&truncate_menu_provider(model)),
            provider.supports_direct_switch,
            provider.active && provider.model == *model,
            None::<&str>,
        )?;
        submenu.append(&item)?;
    }
    menu.append(&submenu)?;
    Ok(())
}

fn provider_submenu_label(provider: &ProviderSummary) -> String {
    let label = provider_label(provider);
    if provider.active {
        format!("✓ {label}")
    } else {
        label
    }
}

struct ProviderModelSelection {
    provider_id: String,
    model: String,
}

fn provider_model_menu_id(provider_id: &str, model: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    format!(
        "{PROVIDER_MODEL_PREFIX}{}:{}",
        URL_SAFE_NO_PAD.encode(provider_id),
        URL_SAFE_NO_PAD.encode(model)
    )
}

fn parse_provider_model_menu_id(id: &str) -> Option<ProviderModelSelection> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    let encoded = id.strip_prefix(PROVIDER_MODEL_PREFIX)?;
    let (provider_id, model) = encoded.split_once(':')?;
    Some(ProviderModelSelection {
        provider_id: String::from_utf8(URL_SAFE_NO_PAD.decode(provider_id).ok()?).ok()?,
        model: String::from_utf8(URL_SAFE_NO_PAD.decode(model).ok()?).ok()?,
    })
}

pub(crate) fn provider_label(provider: &ProviderSummary) -> String {
    let name = escape_menu_text(&truncate_menu_provider(&provider.name));
    if provider.model_selection_controlled_by_codex || provider.model.trim().is_empty() {
        name
    } else {
        format!(
            "{name} | {}",
            escape_menu_text(&truncate_menu_provider(&provider.model))
        )
    }
}

fn truncate_menu_provider(text: &str) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(MENU_PROVIDER_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn escape_menu_text(text: &str) -> String {
    text.replace('&', "&&")
}

#[cfg(test)]
mod tests {
    use super::{initial_menu_labels, parse_provider_model_menu_id, provider_model_menu_id};

    #[test]
    fn initial_menu_follows_the_tray_language() {
        assert_eq!(
            initial_menu_labels(Some("zh")),
            ("Dashboard", "正在加载…", "Quit")
        );
        assert_eq!(
            initial_menu_labels(Some("ru")),
            ("Обзор", "Загрузка…", "Выйти")
        );
        for language in [None, Some("en"), Some("unknown")] {
            assert_eq!(
                initial_menu_labels(language),
                ("Dashboard", "Loading…", "Quit")
            );
        }
    }

    #[test]
    fn provider_model_menu_id_round_trips_special_characters() {
        let id = provider_model_menu_id("relay:one", "openai/gpt:latest 中文");
        let selection = parse_provider_model_menu_id(&id).expect("menu id should be valid");

        assert_eq!(selection.provider_id, "relay:one");
        assert_eq!(selection.model, "openai/gpt:latest 中文");
    }

    #[test]
    fn provider_model_menu_id_rejects_invalid_values() {
        assert!(parse_provider_model_menu_id("tray:provider-model:not-base64:!").is_none());
        assert!(parse_provider_model_menu_id("tray:provider:relay").is_none());
    }
}
