fn dispatch_extended_command(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "set_quota_window_sync_enabled" => serialize(block_on(
            crate::quota_window_sync::set_quota_window_sync_enabled(app, argument(&args, "enabled")?),
        )),
        "get_quota_display_status" => serialize(block_on(crate::quota_display::get_quota_display_status(app))),
        "set_quota_display_all_accounts" => serialize(block_on(crate::quota_display::set_quota_display_all_accounts(
            app, argument(&args, "enabled")?,
        ))),
        "get_pet_dock_status" => serialize(block_on(crate::pet_dock::get_pet_dock_status(app))),
        "set_pet_dock_enabled" => serialize(block_on(crate::pet_dock::set_pet_dock_enabled(
            app, argument(&args, "enabled")?,
        ))),
        "set_pet_dock_labels_visible" => serialize(block_on(crate::pet_dock::set_pet_dock_labels_visible(
            app, argument(&args, "showLabels")?,
        ))),
        "cloud_ssh_profiles" => serialize(block_on(crate::cloud::cloud_ssh_profiles(
            app, argument(&args, "identity")?, argument(&args, "request")?,
        ))),
        "cloud_provider_market" => serialize(block_on(crate::cloud::cloud_provider_market(
            app, argument(&args, "identity")?, argument(&args, "request")?,
        ))),
        "cloud_install_market_provider" => serialize(block_on(crate::cloud::cloud_install_market_provider(
            app, argument(&args, "identity")?, argument(&args, "input")?,
        ))),
        "cloud_lounge_ticket" => serialize(block_on(crate::cloud::cloud_lounge_ticket(
            app, argument(&args, "identity")?,
        ))),
        "codex_gui_cli_status" => serialize(block_on(crate::codex_gui::releases::codex_gui_cli_status(app))),
        "codex_gui_cli_release" => serialize(block_on(crate::codex_gui::releases::codex_gui_cli_release())),
        "codex_gui_cli_check" => serialize(block_on(crate::codex_gui::releases::codex_gui_cli_check(app))),
        "codex_gui_cli_prepare" => serialize(block_on(crate::codex_gui::releases::codex_gui_cli_prepare(app))),
        "codex_gui_cli_install" => serialize(block_on(crate::codex_gui::releases::codex_gui_cli_install(
            app, argument(&args, "version")?,
        ))),
        "get_auto_reset_settings" => serialize(block_on(crate::local_proxy::get_auto_reset_settings(app))),
        "set_auto_reset_settings" => serialize(block_on(crate::local_proxy::set_auto_reset_settings(
            app, argument(&args, "settings")?,
        ))),
        "set_auto_switch_on_quota_exhaustion" => {
            serialize(crate::local_proxy::set_auto_switch_on_quota_exhaustion(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_concurrent_account_routing_enabled" => {
            serialize(block_on(crate::local_proxy::set_concurrent_account_routing_enabled(
                app,
                argument(&args, "enabled")?,
                argument(&args, "accountGroup")?,
            )))
        }
        "set_auto_disable_unreachable_accounts" => {
            serialize(crate::local_proxy::set_auto_disable_unreachable_accounts(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_custom_auto_switch_priority_enabled" => {
            serialize(block_on(crate::local_proxy::set_custom_auto_switch_priority_enabled(
                app,
                argument(&args, "enabled")?,
            )))
        }
        "set_system_prompt_filter_enabled" => serialize(block_on(
            crate::local_proxy::set_system_prompt_filter_enabled(
                app,
                argument(&args, "enabled")?,
            ),
        )),
        "set_system_prompt_filter_rules" => serialize(block_on(
            crate::local_proxy::set_system_prompt_filter_rules(app, argument(&args, "rules")?),
        )),
        "set_system_prompt_injection_enabled" => serialize(block_on(
            crate::local_proxy::set_system_prompt_injection_enabled(
                app,
                argument(&args, "enabled")?,
            ),
        )),
        "set_system_prompt_injection_prompts" => serialize(block_on(
            crate::local_proxy::set_system_prompt_injection_prompts(
                app,
                argument(&args, "prompts")?,
            ),
        )),
        "set_custom_auto_switch_threshold_enabled" => {
            serialize(crate::local_proxy::set_custom_auto_switch_threshold_enabled(
                app,
                argument(&args, "enabled")?,
            ))
        }
        "set_global_auto_switch_threshold" => serialize(block_on(
            crate::local_proxy::set_global_auto_switch_threshold(
                app,
                argument(&args, "threshold")?,
            ),
        )),
        "set_image_generation_account" => serialize(
            crate::local_proxy::set_image_generation_account(app, argument(&args, "accountId")?),
        ),
        "set_image_model_target" => {
            serialize(block_on(crate::local_proxy::set_image_model_target(
                app,
                argument(&args, "routeKind")?,
                argument(&args, "target")?,
            )))
        }
        "set_local_proxy_openai_auth_account" => serialize(block_on(
            crate::local_proxy::set_local_proxy_openai_auth_account(
                app,
                argument(&args, "accountId")?,
            ),
        )),
        "set_local_proxy_listen_on_all_interfaces" => serialize(block_on(
            crate::local_proxy::set_local_proxy_listen_on_all_interfaces(
                app,
                argument(&args, "enabled")?,
                argument(&args, "apiKey")?,
            ),
        )),
        "copy_local_proxy_lan_api_key" => {
            serialize(block_on(crate::local_proxy::read_local_proxy_lan_api_key(
                app, argument(&args, "id")?,
            )))
        }
        "list_local_proxy_lan_api_keys" => serialize(block_on(
            crate::local_proxy::list_local_proxy_lan_api_keys(app),
        )),
        "save_local_proxy_lan_api_key" => serialize(block_on(
            crate::local_proxy::save_local_proxy_lan_api_key(app, argument(&args, "key")?),
        )),
        "delete_local_proxy_lan_api_key" => serialize(block_on(
            crate::local_proxy::delete_local_proxy_lan_api_key(app, argument(&args, "id")?),
        )),
        "set_floating_bubble" => serialize(block_on(crate::floating_bubble::set_floating_bubble(
            app,
            argument(&args, "enabled")?,
        ))),
        "set_privacy_mode" => serialize(crate::floating_bubble::set_privacy_mode(
            app,
            argument(&args, "enabled")?,
        )),
        "set_hide_account_notes" => serialize(crate::floating_bubble::set_hide_account_notes(
            app,
            argument(&args, "enabled")?,
        )),
        "set_show_usage_network_errors" => serialize(
            crate::floating_bubble::set_show_usage_network_errors(app, argument(&args, "enabled")?),
        ),
        "set_token_usage_preferences" => {
            serialize(block_on(crate::floating_bubble::set_token_usage_preferences(
                app,
                argument(&args, "weeks")?,
                argument(&args, "refreshSeconds")?,
                argument(&args, "codexSummaryEnabled")?,
            )))
        }
        "set_auto_disable_status_codes" => serialize(
            crate::commands::set_auto_disable_status_codes(app, argument(&args, "statusCodes")?),
        ),
        "set_bubble_reset_display" => serialize(crate::floating_bubble::set_bubble_reset_display(
            app,
            argument(&args, "display")?,
        )),
        "set_bubble_style" => serialize(crate::floating_bubble::set_bubble_style(
            app,
            argument(&args, "style")?,
        )),
        "set_theme_color" => serialize(crate::floating_bubble::set_theme_color(
            app,
            argument(&args, "color")?,
        )),
        "set_app_language" => serialize(block_on(crate::floating_bubble::set_app_language(
            app,
            argument(&args, "language")?,
        ))),
        "get_cloud_auth_state" => serialize(block_on(crate::cloud::get_cloud_auth_state(app))),
        "get_saved_cloud_login" => serialize(block_on(crate::cloud::get_saved_cloud_login(app))),
        "set_cloud_base_url" => serialize(block_on(crate::cloud::set_cloud_base_url(
            app,
            argument(&args, "baseUrl")?,
        ))),
        "cloud_login" => serialize(block_on(crate::cloud::cloud_login(
            app,
            argument(&args, "email")?,
            argument(&args, "password")?,
            argument(&args, "rememberPassword")?,
        ))),
        "fetch_cloud_announcement" => {
            serialize(block_on(crate::cloud::fetch_cloud_announcement(app)))
        }
        "fetch_cloud_title_settings" => serialize(block_on(crate::cloud::fetch_cloud_title_settings(app))),
        "fetch_cloud_home_presets" => serialize(block_on(crate::cloud::fetch_cloud_home_presets(
            argument(&args, "baseUrl")?, argument(&args, "platform")?,
        ))),
        "fetch_cloud_token_cost_presets" => {
            serialize(block_on(crate::cloud::fetch_cloud_token_cost_presets(app)))
        }
        "fetch_cloud_currency_rates" => {
            serialize(block_on(crate::cloud::fetch_cloud_currency_rates(app)))
        }
        "fetch_cloud_notifications" => {
            serialize(block_on(crate::cloud::fetch_cloud_notifications(app)))
        }
        "fetch_cloud_faqs" => serialize(block_on(crate::cloud::fetch_cloud_faqs(app))),
        "cloud_request_registration_code" => serialize(block_on(
            crate::cloud::cloud_request_registration_code(app, argument(&args, "email")?),
        )),
        "cloud_register" => serialize(block_on(crate::cloud::cloud_register(
            app,
            argument(&args, "email")?,
            argument(&args, "password")?,
            argument(&args, "verificationCode")?,
            argument(&args, "rememberPassword")?,
        ))),
        "cloud_change_password" => serialize(block_on(crate::cloud::cloud_change_password(
            app,
            argument(&args, "currentPassword")?,
            argument(&args, "newPassword")?,
        ))),
        "cloud_logout" => serialize(block_on(crate::cloud::cloud_logout(app))),
        "cloud_sync_accounts" => serialize(block_on(crate::cloud::cloud_sync_accounts(app))),
        "cloud_pull_account" => serialize(block_on(crate::cloud::cloud_pull_account(
            app,
            argument(&args, "id")?,
        ))),
        "cloud_push_accounts" => serialize(block_on(crate::cloud::cloud_push_accounts(app))),
        "cloud_push_account" => serialize(block_on(crate::cloud::cloud_push_account(
            app,
            argument(&args, "id")?,
            argument(&args, "restoreDeleted")?,
        ))),
        "cloud_push_providers" => serialize(block_on(crate::cloud::cloud_push_providers(app))),
        "cloud_push_provider" => serialize(block_on(crate::cloud::cloud_push_provider(
            app,
            argument(&args, "id")?,
            argument(&args, "identity")?,
        ))),
        "cloud_delete_account" => serialize(block_on(crate::cloud::cloud_delete_account(
            app,
            argument(&args, "id")?,
        ))),
        "cloud_pull_totp" => serialize(block_on(crate::cloud::cloud_pull_totp(app))),
        "cloud_list_deleted_accounts" => {
            serialize(block_on(crate::cloud::cloud_list_deleted_accounts(app)))
        }
        "cloud_restore_deleted_account" => serialize(block_on(
            crate::cloud::cloud_restore_deleted_account(app, argument(&args, "id")?),
        )),
        "cloud_list_deleted_providers" => {
            serialize(block_on(crate::cloud::cloud_list_deleted_providers(app)))
        }
        "cloud_restore_deleted_provider" => serialize(block_on(
            crate::cloud::cloud_restore_deleted_provider(app, argument(&args, "id")?),
        )),
        "cloud_delete_provider" => serialize(block_on(crate::cloud::cloud_delete_provider(
            app,
            argument(&args, "id")?,
        ))),
        "list_market_skills" => serialize(block_on(crate::skills_market::list_market_skills(
            app,
            argument(&args, "homeId")?,
        ))),
        "list_prompt_plugins" => serialize(block_on(crate::prompt_plugins::list_prompt_plugins(app))),
        "publish_prompt_plugin" => serialize(block_on(crate::prompt_plugins::publish_prompt_plugin(
            app,
            argument(&args, "pluginId")?,
            argument(&args, "name")?,
            argument(&args, "version")?,
            argument(&args, "type")?,
            argument(&args, "text")?,
        ))),
        "install_prompt_plugin" => serialize(block_on(crate::prompt_plugins::install_prompt_plugin(
            app,
            argument(&args, "pluginId")?,
        ))),
        "remove_prompt_plugin" => serialize(block_on(crate::prompt_plugins::remove_prompt_plugin(
            app,
            argument(&args, "pluginId")?,
        ))),
        "set_prompt_plugin_enabled" => serialize(block_on(crate::prompt_plugins::set_prompt_plugin_enabled(
            app,
            argument(&args, "pluginId")?,
            argument(&args, "enabled")?,
        ))),
        "install_market_skill" => serialize(block_on(crate::skills_market::install_market_skill(
            app,
            argument(&args, "skill")?,
            argument(&args, "homeId")?,
        ))),
        "remove_market_skill" => serialize(block_on(crate::skills_market::remove_market_skill(
            app,
            argument(&args, "skillId")?,
            argument(&args, "homeId")?,
        ))),
        "set_market_skill_enabled" => {
            serialize(block_on(crate::skills_market::set_market_skill_enabled(
                app,
                argument(&args, "skillId")?,
                argument(&args, "enabled")?,
                argument(&args, "homeId")?,
            )))
        }
        "list_official_plugins" => serialize(block_on(
            crate::official_plugins::list_official_plugins(app, argument(&args, "homeId")?),
        )),
        "install_official_plugin" => serialize(block_on(
            crate::official_plugins::install_official_plugin(
                app, argument(&args, "pluginId")?, argument(&args, "homeId")?,
            ),
        )),
        "remove_official_plugin" => serialize(block_on(
            crate::official_plugins::remove_official_plugin(
                app, argument(&args, "pluginId")?, argument(&args, "homeId")?,
            ),
        )),
        "set_official_plugin_enabled" => serialize(block_on(
            crate::official_plugins::set_official_plugin_enabled(
                app,
                argument(&args, "pluginId")?,
                argument(&args, "enabled")?,
                argument(&args, "homeId")?,
            ),
        )),
        "switch_account_and_restart_chatgpt" => serialize(block_on(
            crate::commands::switch_account_and_restart_chatgpt(app, argument(&args, "id")?),
        )),
        "deactivate_account_and_restart_chatgpt" => serialize(block_on(
            crate::commands::deactivate_account_and_restart_chatgpt(app),
        )),
        "set_account_auto_switch_enabled" => {
            serialize(crate::commands::set_account_auto_switch_enabled(
                app,
                argument(&args, "id")?,
                argument(&args, "enabled")?,
            ))
        }
        "set_account_auto_switch_priority" => {
            serialize(block_on(crate::commands::set_account_auto_switch_priority(
                app,
                argument(&args, "id")?,
                argument(&args, "priority")?,
            )))
        }
        "set_account_auto_switch_threshold" => serialize(block_on(
            crate::commands::set_account_auto_switch_threshold(
                app,
                argument(&args, "id")?,
                argument(&args, "threshold")?,
            ),
        )),
        "set_account_group" => serialize(block_on(crate::commands::set_account_group(
            app,
            argument(&args, "id")?,
            argument(&args, "group")?,
        ))),
        "set_account_groups" => serialize(block_on(crate::commands::set_account_groups(
            app,
            argument(&args, "groups")?,
        ))),
        "refresh_usage" => serialize(block_on(crate::commands::refresh_usage(
            app,
            argument(&args, "id")?,
        ))),
        "consume_account_quota" => serialize(block_on(crate::commands::consume_account_quota(
            app,
            argument(&args, "id")?,
        ))),
        "delete_account" => serialize(block_on(crate::commands::delete_account(app, argument(&args, "id")?))),
        "update_account_note" => serialize(block_on(crate::commands::update_account_note(
            app,
            argument(&args, "input")?,
        ))),
        "fetch_reset_credits" => serialize(block_on(crate::commands::fetch_reset_credits(
            app,
            argument(&args, "id")?,
        ))),
        "consume_reset_credit" => serialize(block_on(crate::commands::consume_reset_credit(
            app,
            argument(&args, "id")?,
        ))),
        "restart_chatgpt" => serialize(block_on(crate::commands::restart_chatgpt(app))),
        "launch_chatgpt" => serialize(block_on(crate::commands::launch_chatgpt(app))),
        "get_codex_connection_status" => serialize(block_on(
            crate::codex_connection::get_codex_connection_status(),
        )),
        "connect_codex" => serialize(block_on(crate::codex_connection::connect_codex())),
        "open_managed_folder" => serialize(block_on(crate::commands::open_managed_folder(
            app,
            argument(&args, "target")?,
        ))),
        "get_dream_skin_status" => serialize(block_on(crate::dream_skin::get_dream_skin_status())),
        "get_dream_skin_resources_status" => {
            serialize(Ok(crate::dream_skin::get_dream_skin_resources_status()))
        }
        "retry_dream_skin_resources" => {
            serialize(Ok(crate::dream_skin::retry_dream_skin_resources()))
        }
        "install_dream_skin" => serialize(block_on(crate::dream_skin::install_dream_skin(app))),
        "apply_dream_skin_theme" => serialize(block_on(crate::dream_skin::apply_dream_skin_theme(
            app,
            argument(&args, "themeId")?,
        ))),
        "save_dream_skin_theme" => serialize(block_on(crate::dream_skin::save_dream_skin_theme(
            app,
            argument(&args, "name")?,
        ))),
        "delete_dream_skin_themes" => serialize(block_on(
            crate::dream_skin::delete_dream_skin_themes(argument(&args, "themeIds")?),
        )),
        "set_dream_skin_appearance" => serialize(block_on(
            crate::dream_skin::set_dream_skin_appearance(app, argument(&args, "appearance")?),
        )),
        "set_dream_skin_overlay_opacity" => serialize(block_on(
            crate::dream_skin::set_dream_skin_overlay_opacity(app, argument(&args, "opacity")?),
        )),
        "set_dream_skin_paused" => serialize(block_on(crate::dream_skin::set_dream_skin_paused(
            app,
            argument(&args, "paused")?,
        ))),
        "reapply_dream_skin" => serialize(block_on(crate::dream_skin::reapply_dream_skin(app))),
        "verify_dream_skin" => serialize(block_on(crate::dream_skin::verify_dream_skin(app))),
        "restore_dream_skin" => serialize(block_on(crate::dream_skin::restore_dream_skin(app))),
        "open_dream_skin_folder" => serialize(crate::dream_skin::open_dream_skin_folder(app)),
        "get_dream_skin_theme_preview" => serialize(block_on(
            crate::dream_skin::get_dream_skin_theme_preview(argument(&args, "themeId")?),
        )),
        "get_dream_skin_market" => serialize(block_on(crate::dream_skin::get_dream_skin_market())),
        "install_dream_skin_market_theme" => serialize(block_on(
            crate::dream_skin::install_dream_skin_market_theme(argument(&args, "themeId")?),
        )),
        "get_dream_skin_community_page" => {
            serialize(block_on(crate::dream_skin::get_dream_skin_community_page(
                argument(&args, "offset")?,
                argument(&args, "limit")?,
            )))
        }
        "install_dream_skin_community_theme" => serialize(block_on(
            crate::dream_skin::install_dream_skin_community_theme(argument(&args, "versionId")?),
        )),
        _ => Err(format!(
            "Command is not available in the web version: {command}"
        )),
    }
}
