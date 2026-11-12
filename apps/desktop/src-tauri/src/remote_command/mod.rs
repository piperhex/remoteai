//! Remote diagnostics for computers signed into the same cloud account.
mod automatic;
mod bridge;
mod client;
pub(crate) mod commands;
mod executor;
pub(crate) mod host;
mod install;
mod mcp;
mod mcp_stream;
mod messages;
mod platform;
pub(crate) mod project_check;
mod protocol;
mod state;
#[cfg(windows)]
mod windows_job;

pub(crate) use automatic::setup_gui;
pub(crate) use protocol::default_concurrency_limit;
pub(crate) use protocol::CommandRequest;
use std::{path::PathBuf, sync::Mutex};

const MCP_SERVER: &str = "codex_switch_remote_command";
const HELPER_ARGUMENT: &str = "--remote-command-mcp=";
const VERSION: &str = "1.0.0";
static INSTALL_CHANGES: Mutex<()> = Mutex::new(());

#[derive(Debug, thiserror::Error)]
pub(crate) enum RemoteError {
    #[error("请先登录 Remote AI，再使用远程命令。")]
    Authentication,
    #[error("请先安装并启用远程命令插件。")]
    Disabled,
    #[error("请在目标电脑安装并启用远程命令插件。")]
    Denied,
    #[error("命令请求无效，请检查命令、工作目录和超时时间。")]
    InvalidRequest,
    #[error("远程命令配置无法保存，请重试。")]
    Storage,
    #[error("已有同名配置，请移除冲突配置后重试。")]
    Conflict,
    #[error("连接未完成，请确认两台电脑在线且已更新 Remote AI。")]
    Connection,
    #[error("等待结果超时，命令可能已执行。请先检查状态，再决定是否重试。")]
    Timeout,
    #[error("{}", messages::busy())]
    Busy,
    #[error("命令无法启动，请检查工作目录和所用命令。")]
    Execution,
    #[error("远程命令已停止，连接或授权已失效。")]
    Cancelled,
}

type Result<T> = std::result::Result<T, RemoteError>;

fn root() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("CSW_REMOTE_COMMAND_TEST_ROOT") {
        let root = PathBuf::from(root);
        return if root.is_absolute() && root.parent().is_some() {
            Ok(root)
        } else {
            Err(RemoteError::Storage)
        };
    }
    dirs::data_dir()
        .map(|path| path.join("dev.codex.switch").join("remote-command"))
        .ok_or(RemoteError::Storage)
}

pub(crate) fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || {
        if let Err(error) = root().and_then(|root| bridge::serve(app, &root)) {
            eprintln!("remote command bridge: {error}");
        }
    });
}

#[cfg(windows)]
pub(crate) fn helper_argument(home: &std::path::Path) -> String {
    format!("{HELPER_ARGUMENT}{}", state::home_id(home))
}

/// The MCP process uses STDIO only and never starts a WebView.
pub(crate) fn run_helper() -> bool {
    let Some(id) = std::env::args()
        .nth(1)
        .and_then(|arg| arg.strip_prefix(HELPER_ARGUMENT).map(str::to_owned))
    else {
        return false;
    };
    #[cfg(windows)]
    if let Err(error) = crate::installer_lifecycle::watch(|| std::process::exit(0)) {
        eprintln!("remote command helper shutdown watcher: {error}");
        return true;
    }
    if let Err(error) = root().and_then(|root| mcp::run(&root, &id)) {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}
