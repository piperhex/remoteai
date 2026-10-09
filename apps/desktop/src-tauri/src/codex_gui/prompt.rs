//! Validated user inputs shared by ordinary, queued and steering turns.
use super::error::{GuiError, Result};
use super::images::{self, MAX_IMAGES};
use super::protocol::{directory, thread_params, AccessMode};
use super::upload_policy::TransferMode;
use serde::Deserialize;
use serde_json::{json, Value};
const MAX_PROMPT_BYTES: usize = 256_000;

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct SkillInput {
    name: String,
    path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PromptInput {
    #[serde(default, rename = "transferMode")]
    pub(super) transfer_mode: TransferMode,
    pub(super) text: String,
    pub(super) images: Vec<String>,
    #[serde(default)]
    pub(super) skills: Vec<SkillInput>,
    #[serde(default)]
    pub(super) attachments: Vec<AttachmentInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum AttachmentKind {
    Conversation,
    File,
    Folder,
    Plugin,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AttachmentInput {
    pub(super) kind: AttachmentKind,
    pub(super) name: String,
    pub(super) path: String,
    #[serde(default)]
    pub(super) data: Option<String>,
}

impl AttachmentInput {
    fn into_inputs(self, transfer_mode: TransferMode) -> Result<Vec<Value>> {
        if self.data.is_some()
            || self.name.trim().is_empty()
            || self.name.len() > 500
            || self.name.chars().any(char::is_control)
        {
            return Err(GuiError::InvalidRequest);
        }
        let path = std::path::Path::new(&self.path);
        if matches!(self.kind, AttachmentKind::Conversation) {
            super::conversation_context::reference_id(&self.path)?;
            return Ok(vec![
                json!({"type": "mention", "name": self.name, "path": self.path}),
            ]);
        }
        let valid = match self.kind {
            AttachmentKind::Conversation => false,
            AttachmentKind::File => path.is_absolute() && path.is_file(),
            AttachmentKind::Folder => path.is_absolute() && path.is_dir(),
            AttachmentKind::Plugin => self.path.strip_prefix("plugin://").is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 300
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_.@".contains(c))
            }),
        };
        if !valid {
            return Err(GuiError::InvalidRequest);
        }
        if matches!(self.kind, AttachmentKind::Plugin) {
            return Ok(vec![
                json!({"type": "text", "text": format!("[{}]({})", self.name, self.path), "text_elements": []}),
                json!({"type": "mention", "name": self.name, "path": self.path}),
            ]);
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(self.kind, AttachmentKind::File)
            && ["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str())
        {
            return Ok(vec![image_input(self.path, transfer_mode)?]);
        }
        // Filesystem mentions are not included in model text by the engine; send explicit paths instead.
        let label = if matches!(self.kind, AttachmentKind::Folder) {
            "文件夹"
        } else {
            "文件"
        };
        Ok(vec![
            json!({"type": "text", "text": format!("{label}：{}", self.path), "text_elements": []}),
        ])
    }
}

impl SkillInput {
    fn into_input(self) -> Result<Value> {
        let path = std::path::Path::new(&self.path);
        if self.name.trim().is_empty()
            || self.name.len() > 200
            || self.name.chars().any(char::is_control)
            || !path.is_absolute()
            || path.file_name().is_none_or(|name| name != "SKILL.md")
            || !path.is_file()
        {
            return Err(GuiError::InvalidRequest);
        }
        Ok(json!({"type": "skill", "name": self.name, "path": self.path}))
    }
}

pub(super) struct TurnOptions {
    pub(super) model: Option<String>,
    pub(super) effort: Option<String>,
    pub(super) cwd: Option<String>,
    pub(super) access: Option<AccessMode>,
}

pub(super) fn batch_params(
    thread_id: String,
    messages: Vec<PromptInput>,
    options: TurnOptions,
) -> Result<(&'static str, Value)> {
    const MAX_QUEUED_MESSAGES: usize = 100;
    if messages.is_empty() || messages.len() > MAX_QUEUED_MESSAGES {
        return Err(GuiError::InvalidRequest);
    }
    let mut content = Vec::new();
    for message in messages {
        let (_, mut params) = send_params(
            thread_id.clone(),
            message,
            TurnOptions {
                model: None,
                effort: options.effort.clone(),
                cwd: None,
                access: None,
            },
        )?;
        let input = params["input"]
            .as_array_mut()
            .ok_or(GuiError::InvalidRequest)?;
        content.append(input);
    }
    let mut params = thread_params(thread_id)?;
    params["input"] = json!(content);
    params["model"] = json!(options.model);
    params["effort"] = json!(options.effort);
    if let Some(access) = options.access {
        access.apply_to_turn(&mut params);
    }
    if let Some(cwd) = options.cwd {
        directory(&cwd)?;
        params["cwd"] = json!(cwd);
    }
    Ok(("turn/start", params))
}

pub(super) fn send_params(
    thread_id: String,
    input: PromptInput,
    options: TurnOptions,
) -> Result<(&'static str, Value)> {
    let PromptInput {
        transfer_mode,
        text,
        images,
        skills,
        attachments,
    } = input;
    const MAX_ATTACHMENTS: usize = 32;
    if (text.trim().is_empty() && images.is_empty() && skills.is_empty() && attachments.is_empty())
        || (!transfer_mode.is_direct() && text.len() > MAX_PROMPT_BYTES)
        || images.len() > MAX_IMAGES
        || attachments.len() > MAX_ATTACHMENTS
    {
        return Err(GuiError::InvalidRequest);
    }
    if options.effort.as_ref().is_some_and(|value| {
        ![
            "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
        ]
        .contains(&value.as_str())
    }) {
        return Err(GuiError::InvalidRequest);
    }
    let mut params = thread_params(thread_id)?;
    let mut content = vec![json!({"type": "text", "text": text, "text_elements": []})];
    for image in images {
        content.push(image_input(image, transfer_mode)?);
    }
    for skill in skills {
        content.push(skill.into_input()?);
    }
    for attachment in attachments {
        content.extend(attachment.into_inputs(transfer_mode)?);
    }
    if content
        .iter()
        .filter(|item| matches!(item["type"].as_str(), Some("image" | "localImage")))
        .count()
        > MAX_IMAGES
    {
        return Err(GuiError::InvalidRequest);
    }
    params["input"] = json!(content);
    params["model"] = json!(options.model);
    params["effort"] = json!(options.effort);
    if let Some(access) = options.access {
        access.apply_to_turn(&mut params);
    }
    if let Some(cwd) = options.cwd {
        directory(&cwd)?;
        params["cwd"] = json!(cwd);
    }
    Ok(("turn/start", params))
}

fn image_input(image: String, mode: TransferMode) -> Result<Value> {
    if mode.is_direct() {
        images::input_limited(image, u64::MAX)
    } else {
        images::input(image)
    }
}
