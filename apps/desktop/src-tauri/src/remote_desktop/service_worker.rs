//! Fixed desktop RPCs over the service-owned, SYSTEM-only pipe. No file or shell operation is exposed.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Open {
    display_id: Option<String>,
    expires_at: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Renew {
    id: String,
    expires_at: u64,
}
#[derive(Deserialize)]
struct Id {
    id: String,
}
#[derive(Deserialize)]
struct Privacy {
    id: String,
    enabled: Option<bool>,
    ticket: Option<String>,
}
#[derive(Deserialize)]
struct Update {
    id: String,
    profile: super::stream::Profile,
}
#[derive(Deserialize)]
struct Request {
    request: super::stream::OpenRequest,
}
#[derive(Deserialize)]
struct Signal {
    request: super::stream::SignalRequest,
}
#[derive(Deserialize, Serialize)]
pub(crate) struct Call {
    pub id: u64,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Reply {
    pub id: u64,
    pub data: Option<Value>,
    pub error: Option<String>,
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| "远程操作无效，请重试。".into())
}
fn encode(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "远程操作未完成，请重试。".into())
}

async fn execute(call: Call, root: PathBuf) -> Result<Value, String> {
    match call.command.as_str() {
        "remote_desktop_worker_close" => {
            super::stream::revoke().await;
            super::revoke().map_err(super::safe_error)?;
            Ok(Value::Null)
        }
        "remote_desktop_stream_available" => Ok(json!(true)),
        "remote_desktop_open" => {
            let args: Open = decode(call.args)?;
            tauri::async_runtime::spawn_blocking(move || {
                let settings = crate::desktop_service::configuration::read()
                    .map_err(|_| "桌面服务未就绪。".to_owned())?;
                encode(
                    super::open(args.display_id, settings.permissions, Some(args.expires_at))
                        .map_err(super::safe_error)?,
                )
            })
            .await
            .map_err(|_| "桌面服务未就绪。".to_owned())?
        }
        "remote_desktop_renew" => {
            let args: Renew = decode(call.args)?;
            super::remote_desktop_renew(args.id, args.expires_at).await?;
            Ok(Value::Null)
        }
        "remote_desktop_stream_open" => {
            let args: Request = decode(call.args)?;
            encode(super::stream::open_at(root, args.request).await?)
        }
        "remote_desktop_stream_signal" => {
            let args: Signal = decode(call.args)?;
            encode(super::stream::remote_desktop_stream_signal(args.request).await?)
        }
        "remote_desktop_stream_update" => {
            let args: Update = decode(call.args)?;
            super::stream::remote_desktop_stream_update(args.id, args.profile).await?;
            Ok(Value::Null)
        }
        "remote_desktop_stream_status" => {
            let args: Id = decode(call.args)?;
            encode(super::stream::remote_desktop_stream_status(args.id).await?)
        }
        "remote_desktop_privacy" => {
            let args: Privacy = decode(call.args)?;
            encode(
                super::stream::privacy::remote_desktop_privacy(args.id, args.enabled, args.ticket)
                    .await?,
            )
        }
        "remote_desktop_stream_close" | "remote_desktop_close" => {
            let args: Id = decode(call.args)?;
            super::stream::remote_desktop_stream_close(args.id).await?;
            Ok(Value::Null)
        }
        _ => Err("不支持此远程操作。".into()),
    }
}

pub(crate) fn run(pipe: &str) -> crate::desktop_service::Result<()> {
    use crate::desktop_service::{configuration, platform, ServiceError};
    if !platform::is_system()? || !platform::valid_pipe(pipe) {
        return Err(ServiceError::Denied);
    }
    super::input_desktop::enable_worker();
    std::env::set_var("CSW_DESKTOP_SERVICE_WORKER", "1");
    let root = configuration::install_root()?;
    let stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(pipe)
        .map_err(|_| ServiceError::Unavailable)?;
    let result = serve(stream, root);
    tauri::async_runtime::block_on(super::stream::revoke());
    if let Err(error) = super::revoke() {
        eprintln!("desktop worker input cleanup: {error}");
    }
    result
}

fn serve(mut output: std::fs::File, root: PathBuf) -> crate::desktop_service::Result<()> {
    use crate::desktop_service::ServiceError;
    let mut input = BufReader::new(output.try_clone().map_err(|_| ServiceError::Unavailable)?);
    loop {
        let mut line = String::new();
        let count = input
            .by_ref()
            .take((1024 * 1024 + 1) as u64)
            .read_line(&mut line)
            .map_err(|_| ServiceError::Unavailable)?;
        if count == 0 {
            break;
        }
        if count > 1024 * 1024 || !line.ends_with('\n') {
            return Err(ServiceError::Invalid);
        }
        let call: Call = serde_json::from_str(&line).map_err(|_| ServiceError::Invalid)?;
        let id = call.id;
        // Poll WebRTC initialization on the runtime, as the interactive app does. The
        // standalone Windows entry thread has a smaller stack and can overflow here.
        let task = tauri::async_runtime::spawn(execute(call, root.clone()));
        let result = tauri::async_runtime::block_on(task)
            .unwrap_or_else(|_| Err("桌面服务未就绪，请重试。".into()));
        let reply = match result {
            Ok(data) => Reply {
                id,
                data: Some(data),
                error: None,
            },
            Err(error) => Reply {
                id,
                data: None,
                error: Some(error),
            },
        };
        serde_json::to_writer(&mut output, &reply).map_err(|_| ServiceError::Unavailable)?;
        output
            .write_all(b"\n")
            .map_err(|_| ServiceError::Unavailable)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privileged_capture_requires_an_expiry() {
        assert!(decode::<Open>(json!({"displayId":null})).is_err());
        for expiry in [json!(-1), json!("99999"), json!(null)] {
            assert!(decode::<Open>(json!({"expiresAt":expiry})).is_err());
        }
    }
    #[test]
    fn worker_rejects_general_commands() {
        let call = Call {
            id: 1,
            command: "execute_command".into(),
            args: json!({"command":"whoami"}),
        };
        assert!(tauri::async_runtime::block_on(execute(call, PathBuf::new())).is_err());
    }
}
