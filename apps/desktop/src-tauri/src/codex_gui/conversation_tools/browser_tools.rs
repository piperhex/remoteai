use super::{Error, Result};
use crate::provider_browser::automation::{self, finish, Action, Request};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Open {
    thread_id: String,
    url: String,
    request_id: String,
}

pub(super) async fn execute(app: AppHandle, params: Value) -> Result<Value> {
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if params["name"] == "gui_browser_finish" {
        let request: finish::Finish = serde_json::from_value(arguments)?;
        validate_caller(&params, &request.thread_id)?;
        return Ok(serde_json::to_value(finish::execute(app, request).await?)?);
    }
    let request = match params["name"].as_str() {
        Some("gui_browser_open") => {
            let args: Open = serde_json::from_value(arguments)?;
            Request {
                thread_id: args.thread_id,
                tab_id: None,
                action: Action::Open {
                    url: args.url,
                    request_id: args.request_id,
                },
            }
        }
        Some("gui_browser_use") => serde_json::from_value(arguments)?,
        _ => return Err(Error::Invalid),
    };
    validate_caller(&params, &request.thread_id)?;
    let screenshot = matches!(request.action, Action::Screenshot);
    let mut response = automation::execute(app.clone(), request)
        .await
        .map_err(Error::Browser)?;
    if screenshot {
        response = super::screenshot_artifact::attach(app, response).await?;
    }
    Ok(response)
}

fn validate_caller(params: &Value, thread_id: &str) -> Result<()> {
    if params["_meta"]["x-codex-turn-metadata"]["thread_id"]
        .as_str()
        .is_some_and(|id| id != thread_id)
    {
        return Err(Error::Invalid);
    }
    Ok(())
}
