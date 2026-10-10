use serde_json::{json, Value};
use tauri::AppHandle;

use super::{
    journal::{Claim, Entry, Journal},
    protocol::{Create, Mutation, Send},
    Error, Result,
};
use crate::codex_gui::{connection::Connection, model_settings, protocol::GuiRequest, workspaces};

/// The host service and pure state-machine tests use the same operation ordering.
pub(super) trait Backend {
    async fn request(&self, method: &str, params: Value) -> Result<Value>;
}

impl Backend for Connection {
    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let response = (**self).request(method, params).await?;
        if matches!(method, "thread/start" | "thread/resume") {
            self.publish_tool_conversation(&response).await;
        }
        Ok(response)
    }
}

pub(super) async fn execute(
    app: &AppHandle,
    client: &Connection,
    journal: &Journal,
    mutation: Mutation,
) -> Result<Value> {
    let mut entry = match journal.claim(&client.home, &mutation).await? {
        Claim::Existing(receipt) => return Ok(receipt),
        Claim::New(entry) => entry,
    };
    let result = match mutation {
        Mutation::Create(args) => match prepare_create(app, client, &args).await {
            Ok(params) => create(client, params, args.message, &mut entry).await,
            Err(error) => {
                entry
                    .update(json!({"status":"failed", "error":error.to_string()}))
                    .await
            }
        },
        Mutation::Send(args) => send(client, args, &mut entry).await,
    };
    match result {
        Ok(receipt) => Ok(receipt),
        Err(error) => {
            let mut receipt = entry.receipt();
            receipt["error"] = json!(error.to_string());
            receipt["note"] =
                json!("请先查询对话确认结果，勿重复发送。重试时保持相同的请求标识和内容。");
            entry.update(receipt).await
        }
    }
}

async fn prepare_create(app: &AppHandle, client: &Connection, args: &Create) -> Result<Value> {
    let selection = model_settings::saved_selection(app.clone(), None).await?;
    let model = selection.as_ref().map(|selection| selection.model.clone());
    let mut request = GuiRequest::Start {
        cwd: args.cwd.clone(),
        model,
        access: crate::codex_gui::protocol::AccessMode::WorkspaceWrite,
    };
    let root = client.projectless_root.clone();
    let mut params = tauri::async_runtime::spawn_blocking(move || {
        workspaces::prepare_request(&mut request, &root)?;
        request.into_rpc().map(|(_, params)| params)
    })
    .await
    .map_err(|_| Error::Unavailable)??;
    if let Some(selection) = selection {
        params["config"] = json!({"model_reasoning_effort": selection.effort});
    }
    Ok(params)
}

pub(super) async fn create(
    backend: &impl Backend,
    params: Value,
    message: String,
    entry: &mut Entry,
) -> Result<Value> {
    let response = backend.request("thread/start", params).await?;
    let id = response["thread"]["id"].as_str().ok_or(Error::Changed)?;
    entry
        .update(json!({"threadId":id, "status":"unknown"}))
        .await?;
    let response = backend.request("turn/start", prompt(id, message)).await?;
    let turn_id = response["turn"]["id"].as_str().ok_or(Error::Changed)?;
    entry
        .update(json!({"threadId":id, "turnId":turn_id, "status":"sent"}))
        .await
}

pub(super) async fn send(backend: &impl Backend, args: Send, entry: &mut Entry) -> Result<Value> {
    let id = &args.thread_id;
    entry
        .update(json!({"threadId":id, "status":"unknown"}))
        .await?;
    let mut response = backend
        .request("thread/read", json!({"threadId":id, "includeTurns":true}))
        .await?;
    if response["thread"]["id"] != *id {
        return Err(Error::Changed);
    }
    if response["thread"]["status"]["type"] != "active" {
        // No permission or model override: preserve the target conversation's own settings.
        response = backend
            .request("thread/resume", json!({"threadId":id}))
            .await?;
    }
    let active = active_turn(id, &response)?;
    let mut params = prompt(id, args.message);
    let (method, status) = if let Some(turn_id) = active {
        params["expectedTurnId"] = json!(turn_id);
        ("turn/steer", "steered")
    } else {
        ("turn/start", "sent")
    };
    // A turn can finish between inspection and steering. Never turn a failed steer into a second send.
    let result = backend.request(method, params).await?;
    let turn_id = result["turn"]["id"]
        .as_str()
        .or_else(|| result["turnId"].as_str())
        .ok_or(Error::Changed)?;
    entry
        .update(json!({"threadId":id, "turnId":turn_id, "status":status}))
        .await
}

fn active_turn<'a>(id: &str, response: &'a Value) -> Result<Option<&'a str>> {
    let thread = &response["thread"];
    if thread["id"] != id {
        return Err(Error::Changed);
    }
    let active = thread["turns"]
        .as_array()
        .into_iter()
        .flatten()
        .rev()
        .find(|turn| turn["status"] == "inProgress");
    match active {
        Some(turn) => Ok(Some(turn["id"].as_str().ok_or(Error::Changed)?)),
        None if thread["status"]["type"] == "idle" => Ok(None),
        _ => Err(Error::Changed),
    }
}

fn prompt(id: &str, message: String) -> Value {
    json!({"threadId":id, "input":[{"type":"text", "text":message, "text_elements":[]}]})
}
