use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};

#[cfg(all(unix, not(target_os = "macos")))]
use std::process::Command;

#[cfg(target_os = "windows")]
use std::{thread, time::Instant};

use chrono::{NaiveDate, TimeZone, Utc};
use reqwest::blocking::{Client, Response};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

#[cfg(any(unix, test))]
#[path = "commands/client_unix.rs"]
mod client_unix;

use crate::{
    agent_identity,
    auth::{
        account_fields, canonicalize_chatgpt_auth, is_agent_identity_auth,
        subscription_active_until, token_string, validate_auth,
    },
    codex_api::{
        consume_reset_credit_request, parse_reset_credits, parse_usage, quota_consumption_request,
        quota_consumption_response_completed, refresh_tokens, reset_credits_request,
        token_expiring, usage_request,
    },
    models::{
        AccountSummary, AppInfo, AppSettings, ImageModelTarget, ManagerStateFile,
        ResetCreditsSummary, UpdateAccountDetailsInput, UsageSummary,
    },
    storage::{
        account_dir, account_group_path, account_private_details_path, auto_switch_priority_path,
        auto_switch_threshold_path, change_concurrent_account_routing, expiration_path,
        import_value, load_account_group, load_account_private_details, load_auto_switch_priority,
        load_auto_switch_threshold, load_expiration, load_note, load_official_account_access,
        load_usage, managed_auth_path, note_path, read_app_settings, read_json, read_state,
        resolve_enabled_paths, resolve_paths, save_account_group, save_account_private_details,
        save_auto_switch_priority, save_auto_switch_threshold, save_expiration, save_note,
        save_usage, sync_current_into_store, touch_account_field, try_read_state, usage_path,
        write_app_settings, write_json_atomic, write_json_if_changed,
        write_managed_auth_if_changed, write_managed_auth_if_unchanged, write_state,
        AccountSyncField, Paths,
    },
};

include!("commands/core.rs");
include!("commands/compatible_import.rs");
include!("commands/compatible_parse.rs");
include!("commands/compatible_normalize.rs");
include!("commands/account_switch.rs");
include!("commands/account_switch_apply.rs");
include!("commands/account_management.rs");
include!("commands/account_groups.rs");
include!("commands/conversation_sync.rs");
include!("commands/usage_api.rs");
include!("commands/account_auth_refresh.rs");
include!("commands/usage_refresh.rs");
include!("commands/reset_credits.rs");
include!("commands/client_path.rs");
include!("commands/client_launch.rs");
include!("commands/tests.rs");
