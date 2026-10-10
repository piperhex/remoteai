//! Managed CUA installation and per-home, revocable STDIO sessions.
mod archive;
mod assets;
mod automatic;
pub(crate) mod commands;
mod install;
mod package;
pub(crate) mod permissions;
mod platform;
mod session;
mod state;

use std::path::PathBuf;

pub(crate) use automatic::setup_gui;
static CHANGES: std::sync::Mutex<()> = std::sync::Mutex::new(());

const VERSION: &str = "0.25.0";
const MCP_SERVER: &str = "codex_switch_computer_use";
const HELPER_ARGUMENT: &str = "--computer-use-mcp=";

#[derive(Debug, thiserror::Error)]
pub(crate) enum ComputerError {
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

/// Dispatch before Tauri starts so MCP stdout contains only protocol messages.
pub(crate) fn run_helper() -> bool {
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
