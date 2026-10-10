use std::{
    collections::HashSet,
    fs,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, MutexGuard, OnceLock,
    },
    time::Duration,
};

use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{DateTime, Utc};
use reqwest::{
    blocking::{multipart, Client},
    Method, StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime};
use uuid::Uuid;

use crate::{
    auth::{account_fields, canonicalize_chatgpt_auth, subscription_active_until, validate_auth},
    models::{
        AccountFieldModifiedAt, AppSettings, CloudAccountPayload, CloudAuthState, CloudSyncResult,
        DeletedCloudAccount, DeletedCloudProvider, ProviderFieldModifiedAt, ProviderProfile,
        ProviderSyncPayload,
    },
    skills_market::{SkillMarketItem, SkillMarketResponse, SkillPreview},
    storage::{
        account_private_details_path, auto_switch_priority_path, auto_switch_threshold_path,
        expiration_path, load_account_private_details, load_auto_switch_priority,
        load_auto_switch_threshold, load_expiration, load_note, load_official_account_access,
        load_or_init_account_field_modified_at, load_or_init_last_modified, load_usage,
        managed_auth_path, note_path, official_account_access_path, parse_last_modified,
        read_app_settings, read_json, read_state, resolve_paths, save_account_field_modified_at,
        save_account_private_details, save_auto_switch_priority, save_auto_switch_threshold,
        save_expiration, save_note, save_usage, usage_path, write_app_settings, write_json_atomic,
        write_json_if_changed, write_managed_auth_if_changed, write_state,
    },
};

mod accounts;
mod assistance;
mod auth;
mod common;
mod content;
mod gui_devices;
mod official_usage;
mod prompt_plugins;
mod providers;
mod public_settings;
mod push_identity;
mod request_error;
mod skills;
mod sync_commands;
mod telemetry;
mod token_pricing;
mod totp;
mod transport;
mod types;

#[cfg(test)]
mod tests;

use accounts::*;
pub(crate) use assistance::*;
pub(super) use auth::*;
pub(super) use common::*;
pub(super) use content::*;
pub(crate) use gui_devices::*;
pub(crate) use official_usage::*;
pub(super) use prompt_plugins::*;
use providers::*;
pub(crate) use public_settings::*;
pub(crate) use push_identity::*;
use request_error::request_error;
pub(super) use skills::*;
pub(super) use sync_commands::*;
pub(super) use telemetry::*;
pub(crate) use token_pricing::*;
pub(super) use totp::*;
use transport::*;
pub(super) use types::*;
