//! Built-in, authenticated MCP transport for GUI conversation operations.
mod http;
mod journal;
mod operations;
mod protocol;
mod summaries;
#[cfg(test)]
mod tests;

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use super::{connected, GuiState};

#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("对话请求无效，请检查对话标识、消息内容和项目目录。")]
    Invalid,
    #[error("这个请求标识已用于其他内容，请为新消息使用新的请求标识。")]
    RequestConflict,
    #[error("暂时无法保存发送记录，请先检查对话，勿重复发送。")]
    Storage,
    #[error("暂时无法连接对话工具，请重新打开对话后重试。")]
    Unavailable,
    #[error("对话状态已变化，请重新查询后再发送。")]
    Changed,
    #[error(transparent)]
    Gui(#[from] super::GuiError),
}

impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::Invalid
    }
}

type Result<T> = std::result::Result<T, Error>;

#[derive(Default)]
pub(super) struct Runtime {
    listener: Mutex<Option<http::Listener>>,
    journal: journal::Journal,
}

/// Pass private connection settings only to the GUI engine, never the user's other Codex homes.
pub(super) async fn configure(
    app: AppHandle,
    command: &mut tokio::process::Command,
) -> super::Result<()> {
    let config = tauri::async_runtime::spawn_blocking(move || http::start(&app))
        .await
        .map_err(|_| super::GuiError::Startup)?
        .map_err(|_| super::GuiError::Startup)?;
    for (key, value) in config {
        command.arg("-c").arg(format!(
            "mcp_servers.{}.{key}={value}",
            protocol::SERVER_NAME
        ));
    }
    Ok(())
}

pub(super) fn shutdown(app: &AppHandle) {
    match app.state::<GuiState>().conversation_tools.listener.lock() {
        Ok(mut listener) => {
            if let Some(listener) = listener.take() {
                listener.stop();
            }
        }
        Err(_) => eprintln!("Codex GUI conversation tools cleanup failed"),
    }
}

async fn execute(app: AppHandle, params: Value) -> Result<Value> {
    let tool = protocol::parse(&params)?;
    let state = app.state::<GuiState>();
    let client = connected(&state).await?;
    match tool {
        protocol::Tool::List(args) => Ok(client.running_conversations(args.cursor).await?),
        protocol::Tool::Read(args) => {
            let mut response = client
                .request(
                    "thread/read",
                    json!({"threadId": args.thread_id, "includeTurns": true}),
                )
                .await?;
            super::workspaces::hide_project_paths(&mut response, &client.projectless_root);
            summaries::read(&args.thread_id, response)
        }
        protocol::Tool::Mutate(mutation) => {
            operations::execute(&app, &client, &state.conversation_tools.journal, mutation).await
        }
    }
}
