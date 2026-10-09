fn dispatch_command(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "codex_gui_open_file_preview" => serialize(block_on(
            crate::codex_gui::file_preview::hosted::open(app, argument(&args, "target")?),
        )),
        "codex_gui_close_file_preview" => serialize(block_on(
            crate::codex_gui::file_preview::hosted::close(app, argument(&args, "sessionId")?),
        )),
        "import_account_json_text" => serialize(block_on(crate::commands::import_account_json_text(
            app,
            argument(&args, "content")?,
        ))),
        "list_error_logs" => serialize(block_on(crate::error_logs::list_error_logs(
            argument(&args, "limit")?,
            argument(&args, "beforeId")?,
            argument(&args, "source")?,
            argument(&args, "pagination")?,
        ))),
        "clear_error_logs" => serialize(block_on(crate::error_logs::clear_error_logs())),
        "record_toast_log" => serialize(block_on(crate::error_logs::record_toast_log(
            argument(&args, "message")?,
        ))),
        "read_codex_config_document" => serialize(block_on(
            crate::codex_settings::read_codex_config_document(app, argument(&args, "homeId")?),
        )),
        "validate_codex_config_document" => serialize(block_on(crate::codex_settings::validate_codex_config_document(
            argument(&args, "content")?,
        ))),
        "save_codex_config_document" => serialize(block_on(crate::codex_settings::save_codex_config_document(
            app, argument(&args, "homeId")?,
            argument(&args, "request")?,
        ))),
        "patch_codex_config_document" => serialize(block_on(crate::codex_settings::patch_codex_config_document(
            app, argument(&args, "homeId")?,
            argument(&args, "request")?,
        ))),
        "get_app_info" => serialize(block_on(crate::commands::get_app_info(app))),
        "list_accounts" => serialize(block_on(crate::commands::list_accounts(app))),
        "get_app_settings" => serialize(block_on(crate::floating_bubble::get_app_settings(app))),
        "set_non_proxy_enhancements" => serialize(block_on(
            crate::client_integration::set_non_proxy_enhancements(app, argument(&args, "enabled")?),
        )),
        "set_claude_code_write_target" => serialize(block_on(
            crate::claude_code::set_claude_code_write_target(
                app,
                argument(&args, "target")?,
            ),
        )),
        "set_third_party_app_write_settings" => serialize(block_on(
            crate::third_party_apps::set_third_party_app_write_settings(
                app,
                argument(&args, "settings")?,
            ),
        )),
        "launch_claude_code" => serialize(block_on(crate::claude_code::launch_claude_code(app))),
        "restart_claude_code" => serialize(block_on(crate::claude_code::restart_claude_code(app))),
        "launch_open_code" => serialize(block_on(crate::open_code::launch_open_code(app))),
        "restart_open_code" => serialize(block_on(crate::open_code::restart_open_code(app))),
        "set_gpt_5_6_sol_context_window" => serialize(block_on(
            crate::local_proxy::set_gpt_5_6_sol_context_window(
                app,
                argument(&args, "contextWindow")?,
            ),
        )),
        "get_official_model_context_settings" => serialize(block_on(
            crate::local_proxy::get_official_model_context_settings(app),
        )),
        "refresh_official_model_catalog" => serialize(block_on(
            crate::official_models::refresh_official_model_catalog(app),
        )),
        "set_official_model_context_window" => serialize(block_on(
            crate::local_proxy::set_official_model_context_window(
                app,
                argument(&args, "model")?,
                argument(&args, "contextWindow")?,
            ),
        )),
        "set_sse_idle_timeout" => serialize(block_on(crate::local_proxy::sse_idle_timeout::set_sse_idle_timeout(
            app, argument(&args, "settings")?,
        ))),
        "set_upstream_429_retry_timeout" => serialize(block_on(
            crate::local_proxy::set_upstream_429_retry_timeout(
                app,
                argument(&args, "timeoutSeconds")?,
            ),
        )),
        "set_close_to_tray" => serialize(block_on(crate::main_window::set_close_to_tray(
            app.clone(),
            argument(&args, "enabled")?,
        ))),
        "set_launch_at_startup" => serialize(block_on(crate::autostart::set_launch_at_startup(
            app,
            argument(&args, "enabled")?,
        ))),
        "set_web_proxy_port" => {
            serialize(block_on(set_web_proxy_port(app, argument(&args, "port")?)))
        }
        "set_web_proxy_listen_on_all_interfaces" => serialize(block_on(
            set_web_proxy_listen_on_all_interfaces(app, argument(&args, "enabled")?),
        )),
        "copy_web_proxy_lan_api_key" => serialize(
            stored_web_lan_api_key(&app)?
                .ok_or_else(|| "LAN access key is not available".to_string()),
        ),
        "set_network_proxy" => serialize(block_on(crate::network_proxy::set_network_proxy(
            app,
            argument(&args, "settings")?,
        ))),
        "list_aggregate_apis" => serialize(block_on(crate::aggregate_api::list_aggregate_apis(app))),
        "list_providers" => serialize(block_on(crate::providers::list_providers(app))),
        "save_provider" => serialize(block_on(crate::providers::save_provider(
            app,
            argument(&args, "provider")?,
        ))),
        "fetch_antigravity_models" => serialize(block_on(
            crate::antigravity_provider::fetch_antigravity_models(
                app,
                argument(&args, "baseUrl")?,
                argument(&args, "apiKey")?,
                argument(&args, "providerId")?,
            ),
        )),
        "fetch_claude_code_models" => serialize(block_on(
            crate::claude_code_provider::fetch_claude_code_models(
                app,
                argument(&args, "baseUrl")?,
                argument(&args, "apiKey")?,
                argument(&args, "providerId")?,
            ),
        )),
        "fetch_grok_models" => serialize(block_on(crate::grok_provider::fetch_grok_models(
            app,
            argument(&args, "baseUrl")?,
            argument(&args, "apiKey")?,
            argument(&args, "providerId")?,
        ))),
        "fetch_preset_models" => serialize(block_on(crate::preset_provider::fetch_preset_models(
            app,
            argument(&args, "request")?,
        ))),
        "detect_relay_platform" => {
            serialize(block_on(crate::provider_platform::detect_relay_platform(
                argument(&args, "baseUrl")?,
                argument(&args, "apiKey")?,
            )))
        }
        "fetch_relay_models" => serialize(block_on(crate::provider_models::fetch_relay_models(
            app,
            argument(&args, "baseUrl")?,
            argument(&args, "apiKey")?,
            argument(&args, "providerId")?,
        ))),
        "fetch_deepseek_models" => serialize(block_on(crate::providers::fetch_deepseek_models(
            app,
            argument(&args, "baseUrl")?,
            argument(&args, "apiKey")?,
            argument(&args, "providerId")?,
        ))),
        "query_provider_balance" => serialize(block_on(crate::providers::query_provider_balance(
            app,
            argument(&args, "id")?,
        ))),
        "query_provider_usage" => serialize(block_on(crate::providers::query_provider_usage(
            app,
            argument(&args, "id")?,
        ))),
        "switch_provider" => serialize(block_on(crate::providers::switch_provider(
            app,
            argument(&args, "id")?,
        ))),
        "switch_provider_group" => serialize(block_on(crate::providers::switch_provider_group(
            app,
            argument(&args, "group")?,
        ))),
        "switch_provider_model" => serialize(block_on(crate::providers::switch_provider_model(
            app,
            argument(&args, "id")?,
            argument(&args, "model")?,
        ))),
        "set_provider_model_control" => serialize(block_on(crate::providers::set_provider_model_control(
            app,
            argument(&args, "id")?,
            argument(&args, "controlledByCodex")?,
        ))),
        "set_provider_group" => serialize(block_on(crate::providers::set_provider_group(
            app,
            argument(&args, "id")?,
            argument(&args, "group")?,
        ))),
        "set_provider_groups" => serialize(block_on(crate::providers::set_provider_groups(
            app,
            argument(&args, "groups")?,
        ))),
        "set_provider_auto_switch_enabled" => {
            serialize(crate::providers::set_provider_auto_switch_enabled(
                app,
                argument(&args, "id")?,
                argument(&args, "enabled")?,
            ))
        }
        "repair_codex_config" => {
            serialize(block_on(crate::providers::repair_codex_config(app)))
        }
        "disable_provider" => serialize(block_on(crate::providers::disable_provider(app))),
        "delete_provider" => serialize(crate::providers::delete_provider(
            app,
            argument(&args, "id")?,
        )),
        "get_local_proxy_status" => {
            serialize(block_on(crate::local_proxy::get_local_proxy_status(app)))
        }
        "list_local_proxy_ipv4_addresses" => serialize(block_on(
            crate::local_proxy::endpoints::list_local_proxy_ipv4_addresses(),
        )),
        "list_proxy_sessions" => serialize(block_on(crate::local_proxy::list_proxy_sessions(app))),
        "list_proxy_session_requests" => serialize(block_on(
            crate::local_proxy::list_proxy_session_requests(app, argument(&args, "sessionId")?),
        )),
        "get_proxy_conversation_attachment" => serialize(block_on(
            crate::local_proxy::get_proxy_conversation_attachment(app, argument(&args, "id")?),
        )),
        "get_recent_proxy_session_latency" => serialize(block_on(
            crate::local_proxy::get_recent_proxy_session_latency(),
        )),
        "list_token_usage_entries" => {
            serialize(block_on(crate::local_proxy::list_token_usage_entries(app)))
        }
        "list_token_usage_entries_since" => serialize(block_on(
            crate::local_proxy::list_token_usage_entries_since(
                app,
                argument(&args, "startTs")?,
            ),
        )),
        "list_daily_token_usage" => serialize(block_on(
            crate::local_proxy::list_daily_token_usage(app, argument(&args, "startTs")?),
        )),
        "list_account_token_usage" => serialize(block_on(
            crate::local_proxy::list_account_token_usage(app, argument(&args, "startTs")?),
        )),
        "list_token_usage_breakdown" => serialize(block_on(
            crate::local_proxy::list_token_usage_breakdown(
                app,
                argument(&args, "startTs")?,
                argument(&args, "longContextThresholdTokens")?,
            ),
        )),
        "list_account_quota_history" => serialize(block_on(
            crate::account_quota_history::list_account_quota_history(
                app,
                argument(&args, "startTs")?,
                argument(&args, "endTs")?,
            ),
        )),
        "get_official_usage_summary" => serialize(block_on(crate::cloud::get_official_usage_summary(
            app, argument(&args, "startTs")?,
        ))),
        "list_provider_token_usage" => serialize(block_on(
            crate::local_proxy::list_provider_token_usage(app, argument(&args, "startTs")?),
        )),
        "start_local_proxy" => serialize(block_on(crate::local_proxy::start_local_proxy(app))),
        "stop_local_proxy" => serialize(block_on(crate::local_proxy::stop_local_proxy(app))),
        "stop_local_proxy_without_migrating" => serialize(block_on(
            crate::local_proxy::stop_local_proxy_without_migrating(app),
        )),
        "restore_non_proxy_conversations" => serialize(block_on(
            crate::commands::restore_non_proxy_conversations(app),
        )),
        "browse_codex_threads" => {
            serialize(crate::conversation_hub::browse_codex_threads_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "titleQuery")?,
                argument(&args, "contentQuery")?,
            ))
        }
        "measure_codex_thread_tokens" => serialize(
            crate::conversation_hub::measure_codex_thread_tokens_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionIds")?,
            ),
        ),
        "discard_codex_threads" => {
            serialize(crate::conversation_hub::discard_codex_threads_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionIds")?,
            ))
        }
        "browse_codex_thread_bin" => serialize(
            crate::conversation_hub::browse_codex_thread_bin_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
            ),
        ),
        "recover_codex_threads" => {
            serialize(crate::conversation_hub::recover_codex_threads_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionIds")?,
                argument(&args, "targetHomeId")?,
            ))
        }
        "purge_codex_threads" => serialize(crate::conversation_hub::purge_codex_threads_blocking(
            crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
            argument(&args, "sessionIds")?,
        )),
        "empty_codex_thread_bin" => serialize(
            crate::conversation_hub::empty_codex_thread_bin_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
            ),
        ),
        "inspect_codex_thread_export" => serialize(
            crate::conversation_hub::inspect_codex_thread_export_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionIds")?,
            ),
        ),
        "pack_codex_threads" => serialize(crate::conversation_hub::pack_codex_threads_blocking(
            crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
            argument(&args, "sessionIds")?,
            argument(&args, "exportPath")?,
        )),
        "inspect_codex_thread_import" => serialize(
            crate::conversation_hub::inspect_codex_thread_import_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "importPath")?,
            ),
        ),
        "unpack_codex_threads" => {
            serialize(crate::conversation_hub::unpack_codex_threads_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "importPath")?,
                argument(&args, "sessionIds")?,
            ))
        }
        "migrate_codex_threads_to_home" => serialize(block_on(
            crate::conversation_hub::migrate_codex_threads_to_home(app, argument(&args, "request")?),
        )),
        "migrate_codex_threads" => serialize(
            crate::conversation_hub::migrate_codex_threads_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionIds")?,
            ),
        ),
        "reconcile_codex_thread_visibility" => serialize(block_on(
            crate::conversation_hub::reconcile_codex_thread_visibility(app, argument(&args, "request")?),
        )),
        "rebuild_codex_thread_index" => {
            serialize(crate::conversation_hub::rebuild_codex_thread_index_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
            ))
        }
        "open_codex_thread_file" => {
            serialize(crate::conversation_hub::open_codex_thread_file_blocking(
                crate::conversation_hub::ThreadContext::new(app, argument(&args, "homeId")?)?,
                argument(&args, "sessionId")?,
                argument(&args, "folderOnly")?,
            ))
        }
        _ => dispatch_gui_command(app, command, args),
    }
}
