use super::{protocol, Error, Result};
use csw_ssh_client::{Client, ExecutionOptions};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profiles {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Execute {
    profile_id: String,
    revision: u64,
    command: String,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    30
}

pub(super) async fn execute(app: AppHandle, params: Value) -> Result<Value> {
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if params["name"] == "gui_ssh_profiles" {
        let _: Profiles = serde_json::from_value(arguments)?;
        return tauri::async_runtime::spawn_blocking(move || {
            crate::cloud::agent_ssh_profiles(&app)
                .map(|profiles| json!({ "profiles": profiles }))
                .unwrap_or_else(|error| json!({ "error": error.to_string() }))
        })
        .await
        .map_err(|_| Error::Unavailable);
    }
    let args: Execute = serde_json::from_value(arguments)?;
    protocol::identifier(&args.profile_id)?;
    if args.revision == 0 {
        return Err(Error::Invalid);
    }
    let options = ExecutionOptions {
        command: args.command,
        timeout_seconds: args.timeout_seconds,
    };
    options.validate()?;
    let host = app.clone();
    let request = tauri::async_runtime::spawn_blocking(move || {
        crate::cloud::agent_ssh_connect(&host, &args.profile_id, args.revision)
    })
    .await
    .map_err(|_| Error::Unavailable)?;
    let request = match request {
        Ok(request) => request,
        Err(error) => return Ok(json!({ "error": error.to_string() })),
    };
    let output = app.state::<Arc<Client>>().execute(request, options).await?;
    Ok(serde_json::to_value(output)?)
}
