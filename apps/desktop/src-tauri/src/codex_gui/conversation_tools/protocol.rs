//! Narrow tools for the GUI host, independent of desktop automation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{Error, Result};

pub(super) const MAX_MESSAGE_BYTES: usize = 64_000;
pub(super) const SERVER_NAME: &str = "codex_gui";
pub(super) const TOOLS: &str = include_str!("tools.json");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Create {
    pub request_id: String,
    pub message: String,
    pub cwd: Option<String>,
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
            Self::Create(args) => &args.message,
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
            Tool::Mutate(Mutation::Create(serde_json::from_value(arguments)?))
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
    let (failed, value) = match result {
        Ok(value) => (value.get("error").is_some(), value),
        Err(error) => (true, json!({"error": error.to_string()})),
    };
    json!({"isError": failed, "content": [{"type": "text", "text": value.to_string()}],
        "structuredContent": value})
}
