//! Narrow tools for the GUI host, independent of desktop automation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{Error, Result};
use crate::codex_gui::model_settings::{self, Effort, ModelSelection};

pub(super) const MAX_MESSAGE_BYTES: usize = 64_000;
pub(super) const MAX_TITLE_CHARACTERS: usize = 120;
pub(super) const SERVER_NAME: &str = "codex_gui";
pub(super) const TOOLS: &str = include_str!("tools.json");

pub(super) fn tools() -> Result<Value> {
    let mut tools: Value = serde_json::from_str(TOOLS)?;
    let browser: Value = serde_json::from_str(include_str!("browser_tools.json"))?;
    tools["tools"].as_array_mut().ok_or(Error::Invalid)?.extend(
        browser["tools"]
            .as_array()
            .ok_or(Error::Invalid)?
            .iter()
            .cloned(),
    );
    Ok(tools)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Create {
    pub request_id: String,
    pub message: String,
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<Effort>,
    // Runtime metadata is not a tool argument or part of the durable retry fingerprint.
    #[serde(skip)]
    pub caller: Option<ModelSelection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Send {
    pub request_id: String,
    pub thread_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Read {
    pub thread_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct List {
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub(super) enum Mutation {
    Create(Create),
    Send(Send),
}

impl Mutation {
    pub fn request_id(&self) -> &str {
        match self {
            Self::Create(args) => &args.request_id,
            Self::Send(args) => &args.request_id,
        }
    }

    pub fn validate(&self) -> Result<()> {
        identifier(self.request_id())?;
        let message = match self {
            Self::Create(args) => {
                if let Some(title) = &args.title {
                    validate_title(title)?;
                }
                if let Some(model) = &args.model {
                    model_settings::validate_model(model).map_err(|_| Error::Invalid)?;
                }
                &args.message
            }
            Self::Send(args) => {
                identifier(&args.thread_id)?;
                &args.message
            }
        };
        if message.trim().is_empty() || message.len() > MAX_MESSAGE_BYTES || message.contains('\0')
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

fn validate_title(title: &str) -> Result<()> {
    if title.trim().is_empty()
        || title.chars().count() > MAX_TITLE_CHARACTERS
        || title.chars().any(char::is_control)
    {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) enum Tool {
    Mutate(Mutation),
    Read(Read),
    List(List),
}

pub(super) fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) fn parse(params: &Value) -> Result<Tool> {
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let tool = match params["name"].as_str() {
        Some("gui_create_conversation") => {
            let mut args: Create = serde_json::from_value(arguments)?;
            args.caller = super::selection::caller(params);
            Tool::Mutate(Mutation::Create(args))
        }
        Some("gui_send_message") => {
            Tool::Mutate(Mutation::Send(serde_json::from_value(arguments)?))
        }
        Some("gui_read_conversation") => Tool::Read(serde_json::from_value(arguments)?),
        Some("gui_list_running_conversations") => Tool::List(serde_json::from_value(arguments)?),
        _ => return Err(Error::Invalid),
    };
    match &tool {
        Tool::Mutate(mutation) => mutation.validate()?,
        Tool::Read(args) => identifier(&args.thread_id)?,
        Tool::List(args) => {
            if let Some(cursor) = &args.cursor {
                identifier(cursor)?;
            }
        }
    }
    Ok(tool)
}

pub(super) fn tool_result(result: Result<Value>) -> Value {
    let (failed, mut value) = match result {
        Ok(value) => (value.get("error").is_some(), value),
        Err(error) => (true, json!({"error": error.to_string()})),
    };
    let image = value
        .get_mut("result")
        .and_then(Value::as_object_mut)
        .and_then(|result| result.remove("image"));
    let mut content = vec![json!({"type":"text","text":value.to_string()})];
    if let Some(image) = image.filter(|image| image["mimeType"] == "image/jpeg") {
        content.push(json!({"type":"image","mimeType":image["mimeType"],"data":image["data"]}));
    }
    json!({"isError": failed, "content": content,
        "structuredContent": value})
}
