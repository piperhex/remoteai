mod account_archive;
mod account_quota_history;
mod agent_identity;
mod aggregate_api;
mod aggregate_scheduler;
mod antigravity_provider;
mod auth;
mod autostart;
mod browser;
mod ccs_import;
mod chrome_plugin;
mod claude_code;
mod claude_code_provider;
mod claude_desktop;
mod client_integration;
mod client_lifecycle;
mod cloud;
mod codex_api;
mod codex_config;
mod codex_connection;
mod codex_gui;
mod codex_home;
mod codex_notification;
mod codex_runtime;
mod codex_settings;
mod codex_usage_cost_rates;
mod codex_usage_summary;
mod commands;
mod computer_use;
mod conversation_hub;
#[cfg(windows)]
mod desktop_service;
mod dream_skin;
mod dream_skin_community;
mod dream_skin_market;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod dream_skin_native;
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod dream_skin_resources;
mod error_logs;
mod floating_bubble;
mod grok_provider;
mod gui_terminal;
#[cfg(windows)]
mod installer_lifecycle;
mod launch_options;
mod local_proxy;
mod main_window;
mod models;
mod network_proxy;
mod oauth;
mod official_models;
mod official_plugins;
mod open_code;
mod preset_provider;
mod prompt_plugins;
mod provider_api_cache;
mod provider_connectivity;
mod provider_models;
mod provider_platform;
mod providers;
mod remote_chat;
mod remote_command;
mod remote_control;
mod remote_desktop;
mod remote_websocket;
mod skills_market;
mod storage;
mod system_proxy;
mod system_tray;
mod third_party_apps;
mod totp_qr;
mod web_server;
mod web_session_login;
mod webview_windows;
#[cfg(target_os = "windows")]
mod windows_client_processes;
#[cfg(all(test, windows))]
mod windows_test_resources;

use oauth::AppState;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if desktop_service::run_helper() {
        return;
    }
    #[cfg(windows)]
    if let Err(error) = installer_lifecycle::wait_before_startup() {
        eprintln!("failed to wait for the Windows installer: {error}");
        return;
    }
    if chrome_plugin::run_helper() {
        return;
    }
    if computer_use::run_helper() {
        return;
    }
    if remote_command::run_helper() {
        return;
    }
    if std::env::args_os().any(|argument| argument == "--print-local-proxy-token") {
        println!("{}", providers::LOCAL_PROXY_TOKEN);
        return;
    }
    let launch_options = match launch_options::LaunchOptions::from_environment() {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}\nUsage: csw --headless --port=<1-65535>");
            std::process::exit(2);
        }
    };
    let mut context = tauri::generate_context!();
    if launch_options.headless {
        context.config_mut().app.windows.clear();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            match launch_options::LaunchOptions::parse(args) {
                Ok(options) if options.headless => {
                    if let Some(port) = options.port {
                        if let Err(error) = web_server::restart_at_port(app, port) {
                            eprintln!("failed to apply headless launch request: {error}");
                        }
                    }
                }
                Ok(_) => system_tray::show_dashboard(app),
                Err(error) => eprintln!("invalid launch request: {error}"),
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::default())
        .manage(codex_gui::GuiState::default())
        .manage(codex_gui::file_preview::PreviewSessions::default())
        .manage(codex_gui::notification_navigation::NavigationState::default())
        .manage(codex_gui::releases::CliUpdateState::default())
        .manage(codex_gui::scheduled_tasks::ScheduledTasksState::default())
        .manage(std::sync::Arc::new(gui_terminal::TerminalState::default()))
        .manage(codex_gui::git::GitState::default())
        .manage(codex_gui::web::WebEventState::default())
        .manage(codex_gui::model_settings::ModelSettingsState::default())
        .manage(codex_gui::context_settings::ContextSettingsState::default())
        .manage(ccs_import::ImportState::default())
        .manage(main_window::MainWindowStateCache::default())
        .manage(main_window::CloseBehaviorState::default())
        .manage(floating_bubble::BubbleLifecycle::default())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            #[cfg(windows)]
            app.manage(system_tray::quick_menu::QuickMenuState::default());
            #[cfg(windows)]
            installer_lifecycle::setup(app.handle())?;
            codex_home::initialize_paths(app.handle())?;
            storage::migrate_app_settings_for_version(app.handle())?;
            let settings = storage::read_app_settings(app.handle())?;
            client_integration::setup(app.handle())?;
            if let Err(error) = error_logs::setup(app.handle()) {
                eprintln!("failed to initialize error logs: {error}");
            }
            third_party_apps::capture_running_app_paths(app.handle());
            codex_home::initialize(&settings);
            main_window::configure_close_behavior(app.handle(), settings.close_to_tray);
            if let Err(error) = system_proxy::configure(&settings.network_proxy) {
                eprintln!("failed to restore the network proxy setting: {error}");
            }
            if let Err(error) = autostart::restore_preference(app.handle()) {
                eprintln!("failed to restore the startup setting: {error}");
            }
            if !launch_options.headless {
                main_window::restore_or_set_default(app)?;
            }
            commands::initialize_local_state(app.handle());
            codex_gui::releases::start(app.handle());
            codex_gui::push_notifications::start(app.handle(), &settings);
            chrome_plugin::refresh_on_startup();
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("failed to register desktop import links: {error}");
            }
            match app.deep_link().get_current() {
                Ok(Some(urls)) => {
                    for url in urls {
                        codex_gui::notification_navigation::handle_url(app.handle(), &url);
                    }
                }
                Ok(None) => {}
                Err(error) => eprintln!("failed to read the startup import link: {error}"),
            }
            let import_app = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    codex_gui::notification_navigation::handle_url(&import_app, &url);
                }
            });
            if !launch_options.headless {
                dream_skin::start_background_updates();
                if let Err(error) = codex_runtime::setup(app.handle()) {
                    eprintln!("failed to initialize the Codex renderer channel: {error}");
                }
            }
            match local_proxy::restore_local_proxy_if_enabled(app.handle()) {
                Ok(true) => {}
                Ok(false) => providers::cleanup_stale_local_proxy_config(app.handle())?,
                Err(error) => {
                    eprintln!("failed to restore local proxy: {error}");
                    providers::cleanup_stale_local_proxy_config(app.handle())?;
                }
            }
            official_models::refresh_on_startup(app.handle().clone());
            if !launch_options.headless {
                system_tray::setup(app)?;
                floating_bubble::setup(app.handle())?;
            }
            if let Err(error) = web_server::setup(app.handle(), launch_options.port) {
                if launch_options.headless {
                    return Err(std::io::Error::other(error).into());
                }
                eprintln!("failed to restore web version server: {error}");
            }
            codex_gui::scheduled_tasks::start(app.handle());
            remote_control::start(app.handle().clone());
            remote_command::start(app.handle().clone());
            if !launch_options.headless {
                remote_chat::start(app.handle().clone());
            }
            Ok(())
        })
        .on_page_load(codex_gui::file_preview::handle_page_load)
        .on_window_event(|window, event| {
            codex_gui::file_preview::handle_window_event(window, event);
            if window.label() == "main" {
                if matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                ) {
                    main_window::remember(window);
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    main_window::remember_and_save(window);
                    if main_window::close_to_tray(window) {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
            if window.label() == local_proxy::TOKEN_USAGE_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.destroy();
                }
            }
            if window.label() == web_session_login::WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.destroy() {
                        eprintln!("failed to close ChatGPT web login window: {error}");
                    }
                }
            }
            floating_bubble::handle_window_event(window, event);
            #[cfg(windows)]
            system_tray::quick_menu::handle_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            remote_desktop::remote_desktop_open,
            remote_desktop::remote_desktop_renew,
            #[cfg(windows)]
            desktop_service::remote_desktop_service_status,
            #[cfg(windows)]
            desktop_service::remote_desktop_service_install,
            #[cfg(windows)]
            desktop_service::remote_desktop_service_uninstall,
            remote_desktop::permissions::remote_desktop_permissions,
            remote_desktop::remote_desktop_frame,
            remote_desktop::remote_desktop_input,
            remote_desktop::clipboard::remote_desktop_clipboard,
            remote_desktop::local_clipboard::remote_desktop_read_local_clipboard,
            remote_desktop::local_clipboard::remote_desktop_write_local_clipboard,
            remote_desktop::remote_desktop_close,
            remote_desktop::stream::remote_desktop_stream_open,
            remote_desktop::stream::remote_desktop_stream_available,
            remote_desktop::stream::remote_desktop_stream_signal,
            remote_desktop::stream::remote_desktop_stream_update,
            remote_desktop::stream::remote_desktop_stream_status,
            remote_desktop::stream::remote_desktop_stream_close,
            #[cfg(windows)]
            system_tray::quick_menu::quick_menu_snapshot,
            #[cfg(windows)]
            system_tray::quick_menu::quick_menu_present,
            #[cfg(windows)]
            system_tray::quick_menu::quick_menu_dismiss,
            #[cfg(windows)]
            system_tray::quick_menu::quick_menu_activate,
            codex_gui::codex_gui_connect,
            codex_gui::notification_navigation::codex_gui_take_notification_navigation,
            codex_gui::scheduled_tasks::codex_gui_scheduled_tasks,
            codex_gui::clipboard::codex_gui_clipboard_files,
            codex_gui::attachment_preview::codex_gui_attachment_preview,
            codex_gui::image_actions::codex_gui_image_action,
            codex_gui::account_selection::codex_gui_account_selection,
            codex_gui::account_selection::codex_gui_switch_account,
            codex_gui::model_settings::codex_gui_model_settings,
            codex_gui::queue_store::codex_gui_queue_read,
            codex_gui::queue_store::codex_gui_queue_save,
            codex_gui::context_settings::codex_gui_context_settings,
            codex_gui::context_settings::codex_gui_set_context_settings,
            codex_gui::model_settings::codex_gui_set_model_settings,
            codex_gui::auto_switch_settings::codex_gui_auto_switch_settings,
            codex_gui::auto_switch_settings::codex_gui_set_auto_switch_settings,
            local_proxy::gui_system_prompts::codex_gui_system_prompt_settings,
            local_proxy::gui_system_prompts::codex_gui_set_system_prompt_settings,
            gui_terminal::codex_gui_terminal_open,
            gui_terminal::codex_gui_terminal_command,
            remote_chat::remote_chat_attach,
            remote_chat::remote_chat_send,
            remote_chat::bulk::remote_chat_bulk_send,
            remote_chat::identity::remote_chat_identity,
            remote_chat::host_health::remote_chat_host_alive,
            remote_chat::remote_chat_ack,
            remote_chat::remote_chat_reconnect,
            remote_chat::remote_chat_detach,
            remote_chat::tcp::remote_tcp_open,
            remote_chat::tcp::remote_tcp_listen,
            remote_chat::tcp::remote_tcp_unlisten,
            remote_chat::tcp::remote_tcp_connect,
            remote_chat::tcp::remote_tcp_socket,
            remote_chat::tcp::remote_tcp_close,
            remote_chat::traversal::remote_native_path_open,
            remote_chat::traversal::remote_native_path_send,
            remote_chat::traversal::remote_native_path_close,
            remote_chat::traversal::remote_native_media,
            remote_chat::traversal::remote_chat_local_addresses,
            codex_gui::clipboard_images::codex_gui_remote_clipboard_images,
            remote_chat::gui_remote_open,
            remote_chat::gui_remote_send,
            remote_chat::gui_remote_ack,
            remote_chat::gui_remote_close,
            cloud::codex_gui_devices,
            codex_gui::releases::codex_gui_cli_status,
            codex_gui::releases::codex_gui_cli_release,
            codex_gui::releases::updates::codex_gui_cli_check,
            codex_gui::releases::updates::codex_gui_cli_prepare,
            codex_gui::releases::codex_gui_cli_install,
            codex_gui::codex_gui_request,
            codex_gui::file_stream::bulk::codex_gui_file_bulk_read,
            codex_gui::codex_gui_respond,
            codex_gui::git::codex_gui_git,
            codex_gui::git::tool::codex_gui_git_tool,
            codex_gui::file_actions::codex_gui_file_applications,
            codex_gui::file_actions::codex_gui_file_action,
            codex_gui::file_preview::codex_gui_open_file_preview,
            codex_gui::file_preview::codex_gui_close_file_preview,
            codex_gui::file_preview::website::codex_gui_sync_website_preview,
            codex_gui::file_preview::website::codex_gui_close_website_preview,
            codex_gui::undo::codex_gui_undo,
            codex_gui::deletion::codex_gui_delete_thread,
            codex_gui::usage::codex_gui_usage_summary,
            local_proxy::gui_runtime::codex_gui_request_settings,
            local_proxy::gui_runtime::codex_gui_set_fast_mode,
            local_proxy::gui_runtime::codex_gui_set_request_speed,
            commands::get_app_info,
            ccs_import::take_ccswitch_import_request,
            ccs_import::cancel_ccswitch_provider_import,
            ccs_import::confirm_ccswitch_provider_import,
            commands::open_managed_folder,
            codex_home::set_codex_home,
            codex_home::set_codex_homes,
            commands::list_accounts,
            commands::copy_account_auth_json,
            commands::import_auth_file,
            commands::import_account_json_file,
            commands::import_account_json_text,
            commands::import_account_json_from_clipboard,
            commands::import_compatible_json_file,
            commands::import_sub2api_json_file,
            account_archive::export_accounts_archive,
            account_archive::import_accounts_archive,
            commands::switch_account,
            commands::switch_account_and_restart_chatgpt,
            commands::deactivate_account_and_restart_chatgpt,
            commands::set_account_auto_switch_enabled,
            commands::set_account_auto_switch_priority,
            commands::set_account_auto_switch_threshold,
            commands::set_account_group,
            commands::set_account_groups,
            commands::set_auto_disable_status_codes,
            commands::update_account_note,
            commands::delete_account,
            commands::refresh_usage,
            official_models::refresh_official_model_catalog,
            commands::consume_account_quota,
            commands::fetch_reset_credits,
            commands::consume_reset_credit,
            commands::restart_chatgpt,
            commands::launch_chatgpt,
            codex_connection::get_codex_connection_status,
            codex_connection::connect_codex,
            codex_notification::sync_codex_notification,
            error_logs::list_error_logs,
            error_logs::clear_error_logs,
            error_logs::record_toast_log,
            codex_usage_cost_rates::set_codex_usage_cost_rates,
            claude_code::set_claude_code_write_target,
            third_party_apps::set_third_party_app_write_settings,
            claude_code::launch_claude_code,
            claude_code::restart_claude_code,
            open_code::launch_open_code,
            open_code::restart_open_code,
            commands::restore_non_proxy_conversations,
            conversation_hub::browse_codex_threads,
            conversation_hub::measure_codex_thread_tokens,
            conversation_hub::discard_codex_threads,
            conversation_hub::browse_codex_thread_bin,
            conversation_hub::recover_codex_threads,
            conversation_hub::purge_codex_threads,
            conversation_hub::empty_codex_thread_bin,
            conversation_hub::inspect_codex_thread_export,
            conversation_hub::pack_codex_threads,
            conversation_hub::inspect_codex_thread_import,
            conversation_hub::unpack_codex_threads,
            conversation_hub::migrate_codex_threads,
            conversation_hub::home_migration::migrate_codex_threads_to_home,
            conversation_hub::reconcile_codex_thread_visibility,
            conversation_hub::rebuild_codex_thread_index,
            conversation_hub::open_codex_thread_file,
            dream_skin::get_dream_skin_status,
            dream_skin::get_dream_skin_resources_status,
            dream_skin::retry_dream_skin_resources,
            dream_skin::install_dream_skin,
            dream_skin::apply_dream_skin_theme,
            dream_skin::import_dream_skin_image,
            dream_skin::save_dream_skin_theme,
            dream_skin::delete_dream_skin_themes,
            dream_skin::set_dream_skin_appearance,
            dream_skin::set_dream_skin_overlay_opacity,
            dream_skin::set_dream_skin_paused,
            dream_skin::reapply_dream_skin,
            dream_skin::verify_dream_skin,
            dream_skin::restore_dream_skin,
            dream_skin::open_dream_skin_folder,
            dream_skin::get_dream_skin_theme_preview,
            dream_skin::get_dream_skin_market,
            dream_skin::install_dream_skin_market_theme,
            dream_skin::get_dream_skin_community_page,
            dream_skin::install_dream_skin_community_theme,
            providers::list_providers,
            providers::save_provider,
            provider_connectivity::test_provider_connectivity,
            antigravity_provider::fetch_antigravity_models,
            claude_code_provider::fetch_claude_code_models,
            grok_provider::fetch_grok_models,
            preset_provider::fetch_preset_models,
            provider_models::fetch_relay_models,
            provider_platform::detect_relay_platform,
            providers::fetch_deepseek_models,
            providers::query_provider_balance,
            providers::query_provider_usage,
            providers::switch_provider,
            providers::switch_provider_group,
            providers::switch_provider_model,
            providers::set_provider_model_control,
            providers::set_provider_group,
            providers::set_provider_groups,
            providers::set_provider_auto_switch_enabled,
            providers::repair_codex_config,
            codex_settings::commands::read_codex_config_document,
            codex_settings::commands::validate_codex_config_document,
            codex_settings::commands::save_codex_config_document,
            codex_settings::commands::patch_codex_config_document,
            providers::disable_provider,
            providers::delete_provider,
            aggregate_api::list_aggregate_apis,
            aggregate_api::save_aggregate_api,
            aggregate_api::delete_aggregate_api,
            aggregate_api::switch_aggregate_api,
            local_proxy::get_local_proxy_status,
            local_proxy::endpoints::list_local_proxy_ipv4_addresses,
            local_proxy::set_local_proxy_fast_mode,
            local_proxy::set_gpt_5_6_sol_context_window,
            local_proxy::get_official_model_context_settings,
            local_proxy::set_official_model_context_window,
            local_proxy::set_upstream_429_retry_timeout,
            local_proxy::sse_idle_timeout::set_sse_idle_timeout,
            local_proxy::list_proxy_sessions,
            local_proxy::list_proxy_session_requests,
            local_proxy::get_proxy_conversation_attachment,
            local_proxy::get_proxy_session_unlimited_conversation,
            local_proxy::set_proxy_session_unlimited_conversation,
            local_proxy::get_recent_proxy_session_latency,
            local_proxy::export_diagnostic_logs,
            local_proxy::list_token_usage_entries,
            local_proxy::list_token_usage_entries_since,
            local_proxy::list_daily_token_usage,
            local_proxy::list_account_token_usage,
            local_proxy::list_token_usage_breakdown,
            account_quota_history::list_account_quota_history,
            local_proxy::list_provider_token_usage,
            local_proxy::show_token_usage_window,
            local_proxy::start_local_proxy,
            local_proxy::stop_local_proxy,
            local_proxy::stop_local_proxy_without_migrating,
            local_proxy::set_auto_switch_on_quota_exhaustion,
            local_proxy::get_auto_reset_settings,
            local_proxy::set_auto_reset_settings,
            local_proxy::set_concurrent_account_routing_enabled,
            local_proxy::set_custom_auto_switch_priority_enabled,
            local_proxy::set_custom_auto_switch_threshold_enabled,
            local_proxy::set_global_auto_switch_threshold,
            local_proxy::set_auto_disable_unreachable_accounts,
            local_proxy::set_system_prompt_filter_enabled,
            local_proxy::set_system_prompt_filter_rules,
            local_proxy::set_system_prompt_injection_enabled,
            local_proxy::set_system_prompt_injection_prompts,
            local_proxy::set_image_generation_account,
            local_proxy::set_image_model_target,
            local_proxy::set_local_proxy_openai_auth_account,
            local_proxy::set_local_proxy_listen_on_all_interfaces,
            local_proxy::copy_local_proxy_lan_api_key,
            local_proxy::lan_keys::commands::list_local_proxy_lan_api_keys,
            local_proxy::lan_keys::commands::save_local_proxy_lan_api_key,
            local_proxy::lan_keys::commands::delete_local_proxy_lan_api_key,
            floating_bubble::get_app_settings,
            autostart::set_launch_at_startup,
            main_window::set_close_to_tray,
            client_integration::set_non_proxy_enhancements,
            floating_bubble::set_floating_bubble,
            floating_bubble::set_privacy_mode,
            floating_bubble::set_hide_account_notes,
            floating_bubble::set_show_usage_network_errors,
            floating_bubble::set_token_usage_preferences,
            floating_bubble::set_bubble_reset_display,
            floating_bubble::set_bubble_style,
            floating_bubble::set_theme_color,
            floating_bubble::set_app_language,
            network_proxy::set_network_proxy,
            web_server::set_web_proxy_port,
            web_server::set_web_proxy_listen_on_all_interfaces,
            web_server::copy_web_proxy_lan_api_key,
            floating_bubble::resize_floating_bubble,
            floating_bubble::resize_floating_usage_window,
            floating_bubble::drag_floating_bubble,
            floating_bubble::show_floating_bubble_menu,
            floating_bubble::show_dashboard_from_bubble,
            oauth::start_login,
            web_session_login::start_web_session_login,
            cloud::get_cloud_auth_state,
            cloud::get_saved_cloud_login,
            cloud::fetch_cloud_announcement,
            cloud::fetch_cloud_title_settings,
            cloud::fetch_cloud_home_presets,
            cloud::fetch_cloud_currency_rates,
            cloud::fetch_cloud_token_cost_presets,
            cloud::fetch_cloud_faqs,
            cloud::fetch_cloud_notifications,
            cloud::report_announcement_click,
            cloud::submit_feedback,
            cloud::report_first_installation,
            cloud::report_device_activity,
            cloud::report_base_url_change,
            cloud::set_cloud_base_url,
            cloud::cloud_login,
            cloud::cloud_request_registration_code,
            cloud::cloud_register,
            cloud::cloud_change_password,
            cloud::cloud_logout,
            cloud::cloud_push_accounts,
            cloud::cloud_push_account,
            cloud::cloud_pull_account,
            cloud::cloud_push_providers,
            cloud::cloud_push_provider,
            cloud::cloud_delete_account,
            cloud::cloud_list_deleted_accounts,
            cloud::cloud_restore_deleted_account,
            cloud::cloud_list_deleted_providers,
            cloud::cloud_restore_deleted_provider,
            cloud::cloud_delete_provider,
            cloud::cloud_sync_accounts,
            cloud::cloud_sync_totp,
            cloud::cloud_pull_totp,
            totp_qr::decode_totp_qr_image,
            skills_market::list_market_skills,
            chrome_plugin::commands::chrome_plugin_status,
            chrome_plugin::commands::chrome_plugin_action,
            computer_use::commands::computer_use_status,
            computer_use::commands::computer_use_action,
            computer_use::commands::computer_use_request_permission,
            remote_command::commands::remote_command_status,
            remote_command::commands::remote_command_action,
            skills_market::upload_market_skill,
            skills_market::install_market_skill,
            skills_market::remove_market_skill,
            skills_market::set_market_skill_enabled,
            prompt_plugins::list_prompt_plugins,
            prompt_plugins::publish_prompt_plugin,
            prompt_plugins::install_prompt_plugin,
            prompt_plugins::remove_prompt_plugin,
            prompt_plugins::set_prompt_plugin_enabled,
            official_plugins::list_official_plugins,
            official_plugins::install_official_plugin,
            official_plugins::remove_official_plugin,
            official_plugins::set_official_plugin_enabled,
        ])
        .build(context)
        .unwrap_or_else(|error| {
            eprintln!("failed to start Remote AI: {error}");
            std::process::exit(1);
        })
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                system_tray::show_dashboard(app);
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if gui_terminal::defer_exit(app, &api) {
                    return;
                }
                codex_gui::shutdown(app);
                floating_bubble::shutdown(app);
                web_server::shutdown();
                // Window move/resize events keep this cache current. Reading the
                // native window again while macOS is tearing it down can return a
                // transient, much smaller frame and corrupt the persisted size.
                if let Err(error) = main_window::save_cached(app) {
                    eprintln!("failed to save main window state before exit: {error}");
                }
            }
        });
}
