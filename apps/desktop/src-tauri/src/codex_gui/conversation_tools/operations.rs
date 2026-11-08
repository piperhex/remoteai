use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::AppHandle;

use super::{
    journal::{Claim, Entry, Journal},
    protocol::{Create, Mutation, Send},
    Error, Result,
};
use crate::codex_gui::{
    connection::Connection, model_settings, protocol::GuiRequest,
    title_generation::MAX_PROMPT_CHARS, workspaces,
};
use model_settings::ModelSelection;

/// The host service and pure state-machine tests use the same operation ordering.
pub(super) trait Backend {
    async fn request(&self, method: &str, params: Value) -> Result<Value>;
    async fn save_model(&self, id: &str, selection: &ModelSelection) -> Result<()>;
    fn generate_title(&self, id: &str, prompt: String);
}

struct GuiBackend<'a> {
    app: &'a AppHandle,
    client: &'a Connection,
}

impl Backend for GuiBackend<'_> {
    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let response = self.client.request(method, params).await?;
        if matches!(method, "thread/start" | "thread/resume") {
            self.client.publish_tool_conversation(&response).await;
        }
        Ok(response)
    }

    async fn save_model(&self, id: &str, selection: &ModelSelection) -> Result<()> {
        model_settings::persist_created(self.app.clone(), id.to_owned(), selection.clone()).await?;
        Ok(())
    }

    fn generate_title(&self, id: &str, prompt: String) {
        super::titles::generate(self.app.clone(), id.to_owned(), prompt);
    }
}

pub(super) struct PreparedCreate {
    pub params: Value,
    pub selection: ModelSelection,
    pub message: String,
    pub title: Option<String>,
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
    let backend = GuiBackend { app, client };
    let result = match mutation {
        Mutation::Create(args) => match prepare_create(client.projectless_root.clone(), args).await
        {
            Ok(prepared) => create(&backend, prepared, &mut entry).await,
            Err(error) => {
                entry
                    .update(json!({"status":"failed", "error":error.to_string()}))
                    .await
            }
        },
        Mutation::Send(args) => send(&backend, args, &mut entry).await,
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

pub(super) async fn prepare_create(root: PathBuf, args: Create) -> Result<PreparedCreate> {
    let selection = super::selection::resolve(&args)?;
    let mut request = GuiRequest::Start {
        cwd: args.cwd,
        model: Some(selection.model.clone()),
        access: crate::codex_gui::protocol::AccessMode::WorkspaceWrite,
    };
    let mut params = tauri::async_runtime::spawn_blocking(move || {
        workspaces::prepare_request(&mut request, &root)?;
        request.into_rpc().map(|(_, params)| params)
    })
    .await
    .map_err(|_| Error::Unavailable)??;
    params["config"] = json!({"model_reasoning_effort": selection.effort});
    Ok(PreparedCreate {
        params,
        selection,
        message: args.message,
        title: args.title.map(|title| title.trim().to_owned()),
    })
}

pub(super) async fn create(
    backend: &impl Backend,
    prepared: PreparedCreate,
    entry: &mut Entry,
) -> Result<Value> {
    let response = backend.request("thread/start", prepared.params).await?;
    let id = response["thread"]["id"].as_str().ok_or(Error::Changed)?;
    entry
        .update(json!({"threadId":id, "status":"unknown"}))
        .await?;
    backend.save_model(id, &prepared.selection).await?;
    if let Some(title) = &prepared.title {
        backend
            .request("thread/name/set", json!({"threadId":id, "name":title}))
            .await?;
    }
    let title_prompt = prepared.title.is_none().then(|| {
        prepared
            .message
            .trim()
            .chars()
            .take(MAX_PROMPT_CHARS)
            .collect()
    });
    let mut params = prompt(id, prepared.message);
    params["model"] = json!(prepared.selection.model);
    params["effort"] = json!(prepared.selection.effort);
    let response = backend.request("turn/start", params).await?;
    let turn_id = response["turn"]["id"].as_str().ok_or(Error::Changed)?;
    let receipt = entry
        .update(json!({"threadId":id, "turnId":turn_id, "status":"sent"}))
        .await;
    if let Some(prompt) = title_prompt {
        backend.generate_title(id, prompt);
    }
    receipt
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
