//! Independent Chrome automation: install lifecycle, native messaging, and STDIO MCP.
mod automatic;
pub(crate) mod commands;
mod config;
mod discovery;
mod extension;
mod identity;
mod install;
mod mcp;
mod native;
mod private_storage;
mod protocol;
mod registration;
mod sessions;
mod transport;

use std::{path::PathBuf, sync::Mutex};

pub(crate) use automatic::refresh_on_startup;
static INSTALL_CHANGES: Mutex<()> = Mutex::new(());

const HOST_NAME: &str = "dev.codex_switch.chrome";
const PLUGIN_VERSION: &str = "1.7.0";
const MCP_SERVER: &str = "codex_switch_chrome";

#[derive(Debug, thiserror::Error)]
enum BrowserError {
    #[error("未能复制地址，请在 Chrome 地址栏输入 chrome://extensions/ 并回车。")]
    Clipboard,
    #[cfg(windows)]
    #[error("未找到 Chrome，请先安装 Chrome 浏览器。")]
    ChromeNotFound,
    #[error("未能打开 Chrome，请确认浏览器可正常启动后重试。")]
    ChromeLaunch,
    #[error("浏览器插件操作未完成，请重试。")]
    Storage,
    #[error("浏览器插件尚未安装或已停用。")]
    Disabled,
    #[error("请在 Chrome 中打开浏览器助手并连接。")]
    Disconnected,
    #[error("浏览器操作超时，请查看 Chrome 中是否有待确认的请求。")]
    Timeout,
    #[error("浏览器请求无效，请刷新页面后重试。")]
    InvalidRequest,
    #[error("连接验证失败，请停用后重新启用浏览器助手。")]
    Unauthorized,
    #[error("当前系统暂不支持浏览器插件。")]
    Unsupported,
    #[error("浏览器连接已断开，请重试。")]
    Transport,
    #[error("现有浏览器配置与插件冲突，请先移除同名配置。")]
    Conflict,
}

type Result<T> = std::result::Result<T, BrowserError>;

fn bridge_root() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("CSW_CHROME_TEST_ROOT") {
        let root = PathBuf::from(root);
        if root.is_absolute() && root.parent().is_some() {
            return Ok(root);
        }
        return Err(BrowserError::InvalidRequest);
    }
    dirs::data_dir()
        .map(|path| path.join("dev.codex.switch").join("chrome-bridge"))
        .ok_or(BrowserError::Storage)
}

#[cfg(windows)]
pub(crate) fn helper_argument(home: &std::path::Path) -> String {
    format!("--chrome-mcp={}", config::client_id(home))
}

/// Native Messaging and MCP are separate process modes and never initialize a WebView.
pub(crate) fn run_helper() -> bool {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let is_native = args
        .first()
        .is_some_and(|arg| identity::is_allowed_origin(arg));
    #[cfg(windows)]
    if args
        .first()
        .is_some_and(|arg| is_native || arg.starts_with("--chrome-mcp="))
    {
        // STDIO helpers have no message loop and can be blocked waiting for their client.
        if let Err(error) = crate::installer_lifecycle::watch(|| std::process::exit(0)) {
            eprintln!("failed to watch for installer shutdown: {error}");
            return true;
        }
    }
    let result = if is_native {
        bridge_root().and_then(native::run)
    } else if let Some(client_id) = args
        .first()
        .and_then(|arg| arg.strip_prefix("--chrome-mcp="))
    {
        bridge_root().and_then(|root| mcp::run(&root, client_id))
    } else {
        return false;
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}
