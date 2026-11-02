use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, Shutdown, SocketAddr, TcpStream},
    ops::Deref,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard, OnceLock, RwLock, TryLockError,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::{Local, TimeZone};
use reqwest::blocking::{Client, RequestBuilder};
use upstream_transport::Response as ReqwestResponse;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, Runtime, WebviewUrl};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

#[path = "../chat_bridge_continuation.rs"]
mod chat_bridge_continuation;

const MAX_CONTINUATION_SCOPE_ID_BYTES: usize = 512;

use crate::{
    agent_identity,
    aggregate_api::{self, AggregateApiConfig},
    aggregate_scheduler,
    auth::{account_fields, is_agent_identity_auth, token_string, validate_auth},
    codex_api::{token_expiring, ORIGINATOR},
    models::{
        AccountSummary, AccountTokenUsageTotals, AppSettings, DailyTokenUsage, ImageModelTarget,
        ImageRouteKind, LocalProxyStatus, ManagerStateFile, ProviderApiFormat,
        ProviderBalancePlatform, ProviderKind, ProviderProfile, ProviderTokenUsageTotals,
        ProxySessionLatencySummary, ProxySessionRequestSummary, ProxySessionSummary,
        TokenUsageEntry, UsageSummary, MAX_GPT_5_6_SOL_CONTEXT_WINDOW,
        MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS, MIN_GPT_5_6_SOL_CONTEXT_WINDOW,
        MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
    },
    provider_api_cache,
    providers::{
        self, LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER, LOCAL_PROXY_BASE_URL, LOCAL_PROXY_HOST,
        LOCAL_PROXY_PORT,
    },
    storage::{
        account_group_path, auto_switch_priority_path, auto_switch_threshold_path,
        change_concurrent_account_routing, load_account_group, load_auto_switch_priority,
        load_auto_switch_threshold, load_usage, managed_auth_path, read_app_settings, read_json,
        read_state, resolve_paths, try_read_state, update_state, usage_path, write_app_settings,
        write_json_if_changed, write_managed_auth_if_unchanged, write_state, Paths,
    },
};

const OFFICIAL_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
// Upload inactivity and non-streaming response reads have independent budgets.
// Response headers and SSE reads use separate settings; credential requests use this limit.
const UPSTREAM_RESPONSE_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(60);
const UPSTREAM_UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(240);
const UPSTREAM_TIMEOUT_RETRY_DELAY: Duration = Duration::from_secs(2);
const TOOL_SEARCH_PROXY_NAME: &str = "tool_search";
const CUSTOM_TOOL_INPUT_FIELD: &str = "input";
const CHAT_TOOL_NAME_MAX_LEN: usize = 64;
const DIAGNOSTIC_SCHEMA_VERSION: u32 = 3;
const DIAGNOSTIC_REQUEST_OPTION_MAX_CHARS: usize = 128;
const DIAGNOSTIC_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const DIAGNOSTIC_LOG_FILE_NAME: &str = "local-proxy-diagnostics.jsonl";
const TOKEN_USAGE_JSONL_FILE_NAME: &str = "token-usage.jsonl";
const TOKEN_USAGE_DB_FILE_NAME: &str = "token-usage.sqlite3";
const TOKEN_USAGE_LIST_LIMIT: usize = 500;
const TOKEN_USAGE_CAPTURE_MAX_BYTES: usize = 4 * 1024 * 1024;
const PROXY_SESSION_REQUEST_KEEP_ROWS: usize = 500;
const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT: u64 = 95;
#[cfg(test)]
const GPT_5_6_SOL_MODEL: &str = "gpt-5.6-sol";
pub(crate) const TOKEN_USAGE_WINDOW_LABEL: &str = "token-usage";
const CUSTOM_TOOL_INPUT_DESCRIPTION: &str =
    "Raw string input for the original custom tool. Preserve formatting exactly.";
const CUSTOM_TOOL_PRESERVED_METADATA_HEADING: &str = "Original tool definition:";
const LOCAL_PROXY_LAN_HOST: &str = "0.0.0.0";
const LOCAL_PROXY_START_PROGRESS_EVENT: &str = "local-proxy-start-progress";
const LOCAL_PROXY_STOP_PROGRESS_EVENT: &str = "local-proxy-stop-progress";
const LOCAL_PROXY_REBIND_RETRY_TIMEOUT: Duration = Duration::from_secs(1);
const LOCAL_PROXY_REBIND_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const UPSTREAM_429_INITIAL_DELAY_SECONDS: u64 = 1;
const UPSTREAM_429_DELAY_STEP_SECONDS: u64 = 2;
const CODEX_RATE_LIMIT_REACHED_TYPE_HEADER: &str = "x-codex-rate-limit-reached-type";
const CODEX_USAGE_LIMIT_REACHED_ERROR_TYPE: &str = "usage_limit_reached";
const CODEX_QUOTA_EXHAUSTION_TYPES: [&str; 5] = [
    "rate_limit_reached",
    "workspace_owner_credits_depleted",
    "workspace_member_credits_depleted",
    "workspace_owner_usage_limit_reached",
    "workspace_member_usage_limit_reached",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalProxyTransitionProgress {
    phase: &'static str,
    percent: u8,
    processed_files: Option<usize>,
    total_files: Option<usize>,
}

fn emit_stop_progress<R: Runtime>(
    app: &tauri::AppHandle<R>,
    phase: &'static str,
    percent: u8,
    processed_files: Option<usize>,
    total_files: Option<usize>,
) {
    let _ = app.emit(
        LOCAL_PROXY_STOP_PROGRESS_EVENT,
        LocalProxyTransitionProgress {
            phase,
            percent,
            processed_files,
            total_files,
        },
    );
}

fn emit_start_progress<R: Runtime>(
    app: &tauri::AppHandle<R>,
    phase: &'static str,
    percent: u8,
    processed_files: Option<usize>,
    total_files: Option<usize>,
) {
    let _ = app.emit(
        LOCAL_PROXY_START_PROGRESS_EVENT,
        LocalProxyTransitionProgress {
            phase,
            percent,
            processed_files,
            total_files,
        },
    );
}
