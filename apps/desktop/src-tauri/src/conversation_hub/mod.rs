pub(crate) mod home_migration;
mod home_migration_batch;
mod home_migration_error;
mod home_migration_plan;
mod home_migration_provider;
mod home_migration_reason;
pub(crate) use home_migration::migrate_codex_threads_to_home;

mod context;
pub(crate) use context::ThreadContext;
mod deletion_batch;
pub(crate) mod deletion_plan;
pub(crate) mod synchronization;
mod thread_relations;

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use chrono::{DateTime, Utc};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::storage::{replace_file, write_text_atomic};

const INDEX_NAME: &str = "session_index.jsonl";
const ROLLOUT_FOLDERS: [&str; 2] = ["sessions", "archived_sessions"];
const BUNDLE_KIND: &str = "codex-session-export";
const BUNDLE_REVISION: u32 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadEntry {
    session_id: String,
    session_kind: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    size_bytes: u64,
    match_excerpt: Option<String>,
    account_id: Option<String>,
    account_email: Option<String>,
    account_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadTokenTotals {
    session_id: String,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MutationReport {
    requested_count: usize,
    affected_count: usize,
    released_bytes: u64,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationReport {
    requested_count: usize,
    migrated_count: usize,
    skipped_count: usize,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BinEntry {
    session_id: String,
    title: String,
    cwd: String,
    deleted_at: Option<i64>,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundlePreview {
    package_version: u32,
    exported_at: Option<String>,
    total_count: usize,
    ready_count: usize,
    total_size_bytes: u64,
    items: Vec<BundlePreviewItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundlePreviewItem {
    session_id: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    size_bytes: u64,
    status: String,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundleResult {
    requested_count: usize,
    completed_count: usize,
    skipped_count: usize,
    path: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisibilityReport {
    mode: String,
    scanned_count: usize,
    rollout_count: usize,
    database_row_count: usize,
    catalog_row_count: usize,
    index_entry_count: usize,
    backup_dir: Option<String>,
    dry_run: bool,
    message: String,
}

#[derive(Debug, Clone)]
struct RolloutSnapshot {
    session_id: String,
    title: String,
    explicit_name: Option<String>,
    cwd: String,
    updated_at: Option<i64>,
    path: PathBuf,
    physical_paths: Vec<PathBuf>,
    relative_path: PathBuf,
    index_value: Value,
    size_bytes: u64,
    history_base_thread_id: Option<String>,
    parent_thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    kind: String,
    package_version: u32,
    exported_at: String,
    sessions: Vec<PackageItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageItem {
    session_id: String,
    title: String,
    cwd: String,
    updated_at: Option<i64>,
    relative_rollout_path: String,
    file_entry: String,
    size_bytes: u64,
    sha256: String,
    session_index_entry: Value,
    #[serde(default)]
    source_instance: Option<Value>,
    #[serde(default)]
    state_row: Option<SqliteRowSnapshot>,
    #[serde(default)]
    related_state: Vec<SqliteTableSnapshot>,
    #[serde(default)]
    rollouts: Vec<PackageRollout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageRollout {
    relative_rollout_path: String,
    file_entry: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SqliteRowSnapshot {
    columns: Vec<String>,
    values: Vec<SqliteCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqliteTableSnapshot {
    database: String,
    table: String,
    rows: Vec<SqliteRowSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
enum SqliteCell {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinManifest {
    session_id: String,
    title: String,
    cwd: String,
    original_rollout_path: PathBuf,
    relative_rollout_path: String,
    session_index_entry: Value,
    deleted_at: String,
    #[serde(default)]
    state_visibility: Option<StateVisibilitySnapshot>,
    #[serde(default)]
    state_backup: Option<BinStateBackup>,
    #[serde(default)]
    detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateVisibilitySnapshot {
    rollout_path: String,
    archived: i64,
    archived_at: Option<i64>,
    preview: String,
}

#[derive(Debug, Clone)]
struct BinSnapshot {
    folder: PathBuf,
    manifest: BinManifest,
    rollouts: Vec<PathBuf>,
}

include!("thread_titles.rs");
include!("discovery.rs");
include!("ownership.rs");
include!("state_storage.rs");
include!("state_restore.rs");
include!("bin_state.rs");
include!("bin_files.rs");
include!("bin_recovery.rs");
include!("bin_migration.rs");
include!("discard.rs");
include!("bin.rs");
include!("transfer.rs");
mod rollout_pointer;
mod rollout_selection;
mod transfer_import;
mod transfer_package;
include!("migration.rs");
include!("visibility.rs");
include!("commands.rs");
include!("tests.rs");

#[cfg(test)]
#[path = "thread_title_tests.rs"]
mod thread_title_tests;

#[cfg(test)]
mod discovery_tests;

#[cfg(test)]
mod visibility_provider_tests;

#[cfg(test)]
mod bin_test_support;
#[cfg(test)]
mod bin_tests;
#[cfg(test)]
mod rollout_selection_tests;
#[cfg(test)]
mod transfer_tests;
