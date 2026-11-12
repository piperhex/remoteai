//! Managed CUA installation and per-home, revocable STDIO sessions.
#[cfg(windows)]
pub(crate) mod administrator;
mod archive;
mod assets;
mod automatic;
mod client;
pub(crate) mod commands;
mod install;
mod package;
pub(crate) mod permissions;
mod platform;
mod session;
mod state;
mod upgrade;

use std::path::PathBuf;

pub(crate) use automatic::{setup_gui, SetupKind};
pub(crate) use client::ComputerSession;
pub(crate) use upgrade::start;
static CHANGES: std::sync::Mutex<()> = std::sync::Mutex::new(());

const VERSION: &str = "0.37.0-remoteai.4";
// run_script allows 120 seconds; leave time for dispatch and the final response.
const TOOL_TIMEOUT_SECONDS: u64 = 150;
const MCP_SERVER: &str = "codex_switch_computer_use";
const HELPER_ARGUMENT: &str = "--computer-use-mcp=";

#[derive(Debug, thiserror::Error)]
pub(crate) enum ComputerError {
    #[cfg(windows)]
    #[error("{{\"code\":\"client.computerUseAdmin.authorizationFailed\"}}")]
    Administrator,
    #[error("电脑助手操作未完成，请重试。")]
    Storage,
    #[error("电脑助手支持 Windows 64 位和 macOS 13 及以上系统。")]
    Unsupported,
    #[error("未能打开权限设置，请前往系统设置中的“隐私与安全性”重试。")]
    Permissions,
    #[cfg(any(target_os = "macos", test))]
    #[error("未能重置权限，请在系统设置的“隐私与安全性”中移除旧应用，再重新添加 Remote AI。")]
    PermissionReset,
    #[cfg(any(target_os = "macos", test))]
    #[error("正在修复权限，请稍候再试。")]
    PermissionRepairBusy,
    #[error("下载未完成，请检查网络后重试。")]
    Download,
    #[error("电脑助手文件校验失败，请重新安装。")]
    Integrity,
    #[error("现有设置与电脑助手冲突，请检查同名插件或技能。")]
    Conflict,
    #[error("电脑助手尚未安装、已停用或需要修复。")]
    Disabled,
    #[error("电脑助手启动失败，请尝试修复后重开对话。")]
    Startup,
}

type Result<T> = std::result::Result<T, ComputerError>;

fn root() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("CSW_COMPUTER_USE_TEST_ROOT") {
        let path = PathBuf::from(path);
        if path.is_absolute() && path.parent().is_some() {
            return Ok(path);
        }
        return Err(ComputerError::Storage);
    }
    dirs::data_local_dir()
        .map(|path| path.join("dev.codex.switch").join("computer-use"))
        .ok_or(ComputerError::Storage)
}

#[cfg(windows)]
pub(crate) fn helper_argument(home: &std::path::Path) -> String {
    format!("{HELPER_ARGUMENT}{}", state::home_id(home))
}

/// Dispatch before Tauri starts so MCP stdout contains only protocol messages.
pub(crate) fn run_helper() -> bool {
    #[cfg(windows)]
    if let Some(result) = administrator::run_helper() {
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return true;
    }
    let Some(id) = std::env::args()
        .nth(1)
        .and_then(|arg| arg.strip_prefix(HELPER_ARGUMENT).map(str::to_owned))
    else {
        return false;
    };
    if let Err(error) = root().and_then(|root| session::run(&root, &id)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}
