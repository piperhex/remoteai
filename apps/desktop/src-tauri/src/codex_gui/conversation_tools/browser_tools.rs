use super::{Error, Result};
use crate::provider_browser::automation::{self, Action, Request};
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
    let caller = &params["_meta"]["x-codex-turn-metadata"];
    if caller["thread_id"]
        .as_str()
        .is_some_and(|id| id != request.thread_id)
    {
        return Err(Error::Invalid);
    }
    let screenshot = matches!(request.action, Action::Screenshot);
    let mut response = automation::execute(app.clone(), request)
        .await
        .map_err(Error::Browser)?;
    if screenshot {
        response = super::screenshot_artifact::attach(app, response).await?;
    }
    Ok(response)
}
