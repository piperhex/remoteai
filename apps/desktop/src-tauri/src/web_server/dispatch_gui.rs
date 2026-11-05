fn dispatch_gui_command(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    use crate::codex_gui::{self, GuiState};
    use tauri::Manager;

    match command {
        "codex_gui_browser" => serialize(block_on(crate::provider_browser::automation::codex_gui_browser(
            app, argument(&args, "request")?,
        ))),
        "codex_gui_dictation_prepare" => serialize(block_on(codex_gui::dictation::codex_gui_dictation_prepare(
            app.clone(), app.state::<GuiState>(),
        ))),
        "codex_gui_dictation_transcribe" => serialize(block_on(codex_gui::dictation::codex_gui_dictation_transcribe(
            app.clone(), app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_dictation_cancel" => serialize(block_on(codex_gui::dictation::codex_gui_dictation_cancel(
            app.state::<GuiState>(), argument(&args, "sessionId")?,
        ))),
        "remote_ai_help_cancel" => serialize(block_on(codex_gui::help_assistant::control::remote_ai_help_cancel(
            app.state::<GuiState>(), argument(&args, "requestId")?,
        ))),
        "remote_ai_help_questions" => serialize(block_on(codex_gui::help_assistant::remote_ai_help_questions(app))),
        "remote_ai_help_status" => serialize(block_on(codex_gui::help_assistant::remote_ai_help_status(
            app.clone(), app.state::<GuiState>(),
        ))),
        "remote_ai_help_ask" => serialize(block_on(codex_gui::help_assistant::remote_ai_help_ask(
            app.clone(), app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_queue_read" => serialize(block_on(codex_gui::queue_store::codex_gui_queue_read(app))),
        "codex_gui_queue_save" => serialize(block_on(codex_gui::queue_store::codex_gui_queue_save(
            app, argument(&args, "snapshot")?,
        ))),
        "codex_gui_request_settings" => serialize(block_on(
            crate::local_proxy::gui_runtime::codex_gui_request_settings(app),
        )),
        "codex_gui_set_fast_mode" => serialize(block_on(
            crate::local_proxy::gui_runtime::codex_gui_set_fast_mode(app, argument(&args, "enabled")?),
        )),
        "codex_gui_set_request_speed" => serialize(block_on(
            crate::local_proxy::gui_runtime::codex_gui_set_request_speed(app, argument(&args, "speed")?),
        )),
        "codex_gui_context_settings" => serialize(block_on(
            codex_gui::context_settings::codex_gui_context_settings(app, argument(&args, "threadId")?),
        )),
        "codex_gui_set_context_settings" => serialize(block_on(
            codex_gui::context_settings::codex_gui_set_context_settings(
                app, argument(&args, "threadId")?, argument(&args, "settings")?,
            ),
        )),
        "codex_gui_model_context_settings" => serialize(block_on(
            codex_gui::model_context::codex_gui_model_context_settings(app),
        )),
        "codex_gui_set_model_context" => serialize(block_on(
            codex_gui::model_context::codex_gui_set_model_context(
                app, argument(&args, "model")?, argument(&args, "capacity")?,
            ),
        )),
        "codex_gui_scheduled_tasks" => serialize(block_on(
            codex_gui::scheduled_tasks::codex_gui_scheduled_tasks(app, argument(&args, "request")?),
        )),
        "codex_gui_model_settings" => serialize(block_on(
            codex_gui::model_settings::codex_gui_model_settings(app, argument(&args, "threadId")?),
        )),
        "codex_gui_set_model_settings" => serialize(block_on(
            codex_gui::model_settings::codex_gui_set_model_settings(
                app, argument(&args, "threadId")?, argument(&args, "selection")?,
            ),
        )),
        "codex_gui_auto_switch_settings" => serialize(block_on(
            codex_gui::auto_switch_settings::codex_gui_auto_switch_settings(app),
        )),
        "codex_gui_set_auto_switch_settings" => serialize(block_on(
            codex_gui::auto_switch_settings::codex_gui_set_auto_switch_settings(app, argument(&args, "settings")?),
        )),
        "codex_gui_system_prompt_settings" => serialize(block_on(
            crate::local_proxy::gui_system_prompts::codex_gui_system_prompt_settings(app),
        )),
        "codex_gui_set_system_prompt_settings" => serialize(block_on(
            crate::local_proxy::gui_system_prompts::codex_gui_set_system_prompt_settings(
                app, argument(&args, "settings")?,
            ),
        )),
        "codex_gui_account_selection" => serialize(block_on(
            codex_gui::account_selection::codex_gui_account_selection(app),
        )),
        "codex_gui_switch_account" => serialize(block_on(
            codex_gui::account_selection::codex_gui_switch_account(app, argument(&args, "selection")?),
        )),
        "codex_gui_git_tool" => serialize(block_on(codex_gui::git::tool::codex_gui_git_tool(
            app.clone(), app.state::<codex_gui::git::GitState>(), argument(&args, "request")?,
        ))),
        "codex_gui_git" => serialize(block_on(codex_gui::git::codex_gui_git(
            app.clone(), app.state::<codex_gui::git::GitState>(), argument(&args, "request")?,
        ))),
        "codex_gui_undo" => serialize(block_on(codex_gui::undo::codex_gui_undo(
            app.clone(), app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_delete_thread" => serialize(block_on(codex_gui::deletion::codex_gui_delete_thread(
            app.clone(), app.state::<GuiState>(), argument(&args, "threadId")?,
        ))),
        "codex_gui_connect" => serialize(block_on(codex_gui::connect_web(
            app.clone(), app.state::<GuiState>(), argument(&args, "reuseExisting")?,
        ))),
        "codex_gui_request" => serialize(block_on(codex_gui::codex_gui_request(
            app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_respond" => serialize(block_on(codex_gui::codex_gui_respond(
            app.state::<GuiState>(), argument(&args, "reply")?,
        ))),
        "codex_gui_events" => serialize(codex_gui::web::poll(
            &app, argument(&args, "cursor")?, argument(&args, "viewedThreads")?,
        )),
        "codex_gui_usage_summary" => serialize(block_on(codex_gui::usage::codex_gui_usage_summary(app))),
        _ => dispatch_extended_command(app, command, args),
    }
}
