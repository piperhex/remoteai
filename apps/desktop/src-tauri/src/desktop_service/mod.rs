//! Optional Windows SYSTEM supervisor. The remote UI and media protocol stay the same.
mod assets;
mod commands;
pub(crate) mod configuration;
mod connectivity;
pub(crate) mod control;
mod control_listener;
pub(crate) mod delegation;
mod framing;
mod installer;
pub(crate) mod platform;
mod process;
mod setup;
mod startup;
mod supervisor;
mod upgrade;
pub(crate) use commands::*;
pub(crate) use setup::setup_gui;
pub(crate) use startup::start;

pub(crate) const NAME: &str = "CodexSwitchRemoteDesktop";
#[derive(Debug, thiserror::Error)]
pub(crate) enum ServiceError {
    #[error("无人值守服务未就绪，请稍后重试。")]
    Unavailable,
    #[error("服务设置无效，请重新启用无人值守。")]
    Invalid,
    #[error("此操作需要电脑管理员确认。")]
    Denied,
    #[error("无人值守设置未能保存，请重试。")]
    Storage,
    #[error("请先更新电脑应用和服务器，再启用无人值守。")]
    Setup,
    #[error("本机已停用并卸载。云端授权未能撤销，请联网后在设备管理中撤销授权。")]
    RevocationPending,
    #[error("{0}")]
    Remote(String),
}
pub(crate) type Result<T> = std::result::Result<T, ServiceError>;

/// Helpers run before Tauri creates windows. Only SCM/elevated installers can enter privileged paths.
pub(crate) fn run_helper() -> bool {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("--remote-desktop-service") => supervisor::dispatch(),
        Some("--remote-desktop-worker") => args
            .get(2)
            .ok_or(ServiceError::Invalid)
            .and_then(|pipe| crate::remote_desktop::service_worker::run(pipe)),
        Some("--install-desktop-service") => args
            .get(2)
            .ok_or(ServiceError::Invalid)
            .and_then(|path| installer::install(std::path::Path::new(path))),
        Some("--uninstall-desktop-service") => installer::uninstall(),
        Some("--update-desktop-service") => args
            .get(2)
            .ok_or(ServiceError::Invalid)
            .and_then(|version| upgrade::run(version)),
        _ => return false,
    };
    if let Err(error) = result {
        std::process::exit(if matches!(error, ServiceError::RevocationPending) {
            2
        } else {
            1
        });
    }
    true
}
