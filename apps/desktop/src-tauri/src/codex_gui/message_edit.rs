//! Replace the latest user message within its existing conversation.
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    client::Client,
    error::{GuiError, Result},
    images::MAX_IMAGES,
    prompt::SkillInput,
    protocol::{id, thread_params, AccessMode, GuiRequest, GuiResponse},
    workspaces,
};

#[cfg(test)]
#[path = "message_delete_tests.rs"]
mod delete_tests;
#[cfg(test)]
#[path = "message_edit_tests.rs"]
mod tests;

const MAX_EDIT_BYTES: usize = 256_000;
// Keep the continue button's hidden instruction aligned with the message list.
const CONTINUE_MESSAGE: &str = "请继续完成刚才中断的任务。";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditRequest {
    thread_id: String,
    turn_id: String,
    item_id: String,
    text: String,
    #[serde(default)]
    removed_image_indexes: Vec<usize>,
    #[serde(default)]
    images: Vec<String>,
    skills: Option<Vec<SkillInput>>,
    model: Option<String>,
    effort: Option<String>,
    access: AccessMode,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteRequest {
    thread_id: String,
    turn_id: String,
    item_id: String,
    access: AccessMode,
}

pub(super) async fn delete(client: &Client, target: DeleteRequest) -> Result<GuiResponse> {
    let edit = EditRequest {
        thread_id: target.thread_id,
        turn_id: target.turn_id,
        item_id: target.item_id,
        text: String::new(),
        removed_image_indexes: vec![],
        images: vec![],
        skills: None,
        model: None,
        effort: None,
        access: target.access,
        cwd: None,
    };
    id(&edit.thread_id)?;
    id(&edit.turn_id)?;
    id(&edit.item_id)?;
    let mut data = delete_message(&edit, |method, params| client.request(method, params)).await?;
    workspaces::hide_project_paths(&mut data, &client.projectless_root);
    Ok(GuiResponse { data })
}

async fn delete_message<F, Fut>(edit: &EditRequest, mut request: F) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let source = load_edit_history(edit, &json!({}), &mut request).await?;
    let turn = editable_turn(&source["thread"], edit)?;
    // The server can only rewind whole turns. Never delete an earlier user input silently.
    let first = turn["items"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["type"] == "userMessage"));
    if first.is_none_or(|item| item["id"] != edit.item_id) {
        return Err(GuiError::MessageDeleteBoundary);
    }
    rewind_history(&source["thread"], edit, &mut request).await
}

fn validate(edit: &EditRequest) -> Result<()> {
    id(&edit.thread_id)?;
    id(&edit.turn_id)?;
    id(&edit.item_id)?;
    if edit.text.trim().is_empty() || edit.text.len() > MAX_EDIT_BYTES {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}

fn latest_message(turns: &[Value]) -> Option<(&Value, &Value)> {
    turns.iter().enumerate().rev().find_map(|(index, turn)| {
        let mut users = turn["items"]
            .as_array()?
            .iter()
            .filter(|item| item["type"] == "userMessage");
        let first = users.next()?;
        let hidden = index > 0
            && matches!(
                turns[index - 1]["status"].as_str(),
                Some("interrupted" | "failed")
            )
            && first["content"].as_array().is_some_and(|parts| {
                parts.len() == 1
                    && parts[0]["type"] == "text"
                    && parts[0]["text"] == CONTINUE_MESSAGE
            });
        users
            .next_back()
            .or(if hidden { None } else { Some(first) })
            .map(|item| (turn, item))
    })
}

fn editable_turn<'a>(thread: &'a Value, edit: &EditRequest) -> Result<&'a Value> {
    let turns = thread["turns"].as_array().ok_or(GuiError::InvalidRequest)?;
    if thread["status"]["type"] == "active"
        || turns.iter().any(|turn| turn["status"] == "inProgress")
    {
        return Err(GuiError::InvalidRequest);
    }
    let (turn, item) = latest_message(turns).ok_or(GuiError::InvalidRequest)?;
    if turn["id"] != edit.turn_id || item["id"] != edit.item_id {
        return Err(GuiError::InvalidRequest);
    }
    Ok(turn)
}

fn edited_input(thread: &Value, edit: &EditRequest) -> Result<Vec<Value>> {
    let turn = editable_turn(thread, edit)?;
    let mut input = Vec::new();
    // Steering messages share a server turn. Replay its earlier user inputs in order.
    for message in turn["items"].as_array().ok_or(GuiError::InvalidRequest)? {
        if message["type"] != "userMessage" {
            continue;
        }
        let content = message["content"]
            .as_array()
            .ok_or(GuiError::InvalidRequest)?;
        if message["id"] == edit.item_id {
            input.push(json!({"type": "text", "text": edit.text, "text_elements": []}));
            input.extend(edited_attachments(content, edit)?);
            break;
        }
        input.extend(content.iter().cloned());
    }
    Ok(input)
}

fn send_request(edit: &EditRequest) -> GuiRequest {
    GuiRequest::Send {
        transfer_mode: Default::default(),
        thread_id: edit.thread_id.clone(),
        text: edit.text.clone(),
        images: edit.images.clone(),
        skills: edit.skills.clone().unwrap_or_default(),
        attachments: vec![],
        model: edit.model.clone(),
        effort: edit.effort.clone(),
        access: None,
        cwd: edit.cwd.clone(),
    }
}

async fn prepare(client: &Client, edit: &EditRequest) -> Result<Value> {
    let mut request = send_request(edit);
    let root = client.projectless_root.clone();
    let mut params = tauri::async_runtime::spawn_blocking(move || {
        workspaces::prepare_request(&mut request, &root)?;
        request.into_rpc().map(|(_, params)| params)
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)??;
    edit.access.apply_to_turn(&mut params);
    Ok(params)
}

fn rollback_params(thread: &Value, edit: &EditRequest) -> Result<Value> {
    let turns = thread["turns"].as_array().ok_or(GuiError::InvalidRequest)?;
    let index = turns
        .iter()
        .position(|turn| turn["id"] == edit.turn_id)
        .ok_or(GuiError::InvalidRequest)?;
    Ok(json!({"threadId": edit.thread_id, "numTurns": turns.len() - index}))
}

fn rewind_request(thread: &Value, edit: &EditRequest) -> Result<(&'static str, Value)> {
    if thread["historyMode"] == "paginated" {
        return Ok((
            "thread/revert",
            json!({"threadId": edit.thread_id, "beforeTurnId": edit.turn_id}),
        ));
    }
    Ok(("thread/rollback", rollback_params(thread, edit)?))
}

pub(super) async fn submit(client: &Client, edit: EditRequest) -> Result<GuiResponse> {
    validate(&edit)?;
    let params = prepare(client, &edit).await?;
    let mut data = replace_message(&edit, params, |method, params| {
        client.request(method, params)
    })
    .await?;
    workspaces::hide_project_paths(&mut data, &client.projectless_root);
    Ok(GuiResponse { data })
}

async fn load_edit_history<F, Fut>(
    edit: &EditRequest,
    params: &Value,
    request: &mut F,
) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    // Read-only history loads do not activate the session required by rollback.
    let mut resume = thread_params(edit.thread_id.clone())?;
    edit.access.apply_to_thread(&mut resume);
    if let Some(cwd) = params.get("cwd") {
        resume["cwd"] = cwd.clone();
    }
    request("thread/resume", resume).await?;
    // Interrupted turns can get transient item IDs in resume responses. Read the
    // persisted history used by the UI so stale-target checks compare stable IDs.
    request(
        "thread/read",
        json!({"threadId": edit.thread_id, "includeTurns": true}),
    )
    .await
}

fn edited_attachments(content: &[Value], edit: &EditRequest) -> Result<Vec<Value>> {
    let mut retained = retained_attachments(content, &edit.removed_image_indexes)?;
    let image_count = retained
        .iter()
        .filter(|part| matches!(part["type"].as_str(), Some("image" | "localImage")))
        .count();
    if image_count + edit.images.len() > MAX_IMAGES {
        return Err(GuiError::InvalidRequest);
    }
    if edit.skills.is_some() {
        retained.retain(|part| part["type"] != "skill");
    }
    let mut inputs = Vec::new();
    for part in retained {
        let path = part["path"].as_str().unwrap_or_default();
        if part["type"] == "mention" && path.starts_with("coze://") {
            inputs.extend(super::coze_reference::inputs(
                path,
                part["name"].as_str().unwrap_or_default(),
            )?);
        } else if part["type"] == "mention" && path.starts_with(super::ssh_reference::PREFIX) {
            inputs.extend(super::ssh_reference::inputs(
                path,
                part["name"].as_str().unwrap_or_default(),
            )?);
        } else {
            inputs.push(part);
        }
    }
    Ok(inputs)
}

fn retained_attachments(content: &[Value], removed: &[usize]) -> Result<Vec<Value>> {
    let is_image = |part: &&Value| part["type"] == "image" || part["type"] == "localImage";
    let image_count = content.iter().filter(is_image).count();
    let removed: std::collections::BTreeSet<_> = removed.iter().copied().collect();
    if removed.iter().any(|index| *index >= image_count) {
        return Err(GuiError::InvalidRequest);
    }
    let mut image_index = 0;
    Ok(content
        .iter()
        .filter(|part| {
            if !is_image(part) {
                return part["type"] != "text";
            }
            let retain = !removed.contains(&image_index);
            image_index += 1;
            retain
        })
        .cloned()
        .collect())
}

async fn replace_message<F, Fut>(
    edit: &EditRequest,
    mut params: Value,
    mut request: F,
) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let source = load_edit_history(edit, &params, &mut request).await?;
    // Retain stored attachments and append additions validated by the ordinary send path.
    let mut input = edited_input(&source["thread"], edit)?;
    if let Some(additions) = params["input"].as_array() {
        input.extend(
            additions
                .iter()
                .filter(|part| part["type"] != "text")
                .cloned(),
        );
    }
    params["input"] = json!(input);
    let mut data = rewind_history(&source["thread"], edit, &mut request).await?;
    match request("turn/start", params).await {
        Ok(response) => data["turn"] = response["turn"].clone(),
        Err(error) => {
            // Return the retained history so clients can recover the edited draft.
            data["error"] = json!(error.to_string());
        }
    }
    Ok(data)
}

async fn rewind_history<F, Fut>(
    thread: &Value,
    edit: &EditRequest,
    request: &mut F,
) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let (method, rewind) = rewind_request(thread, edit)?;
    let mut data = request(method, rewind).await?;
    // Paginated revert returns metadata only. The validated prefix remains unchanged.
    if method == "thread/revert" {
        data["thread"]["turns"] = json!(thread["turns"]
            .as_array()
            .ok_or(GuiError::Rpc)?
            .iter()
            .take_while(|turn| turn["id"] != edit.turn_id)
            .collect::<Vec<_>>());
    }
    Ok(data)
}
