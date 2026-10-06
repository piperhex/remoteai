use std::{collections::HashMap, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{GuiError, Result};
use super::goals::{self, GoalStatus};
use super::prompt::{
    batch_params, send_params, AttachmentInput, PromptInput, SkillInput, TurnOptions,
};

const PAGE_SIZE: u64 = 50;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum GuiRequest {
    DownloadBrowse(super::downloads::Browse),
    DownloadOpen(super::downloads::Open),
    PreviewOpen(super::preview_download::Open),
    GenerateTitle(super::title_generation::TitleRequest),
    FileOpen(super::file_stream::StreamOpen),
    FileRead(super::file_stream::StreamRead),
    FileClose(super::file_stream::StreamClose),
    FileManifest(super::file_stream::bulk::ManifestRead),
    VideoOpen(super::file_stream::StreamOpen),
    VideoRead(super::file_stream::StreamRead),
    VideoClose(super::file_stream::StreamClose),
    TextPreview {
        thread_id: String,
        path: String,
        max_bytes: Option<u64>,
    },
    ProjectFiles(super::project_files::ProjectFilesRequest),
    ProjectDirectories {
        directory: String,
    },
    EditMessage(super::message_edit::EditRequest),
    ImagePreview {
        thread_id: String,
        source: String,
        #[serde(default)]
        variant: super::image_thumbnail::ImageVariant,
        max_bytes: Option<u64>,
    },
    Models {
        cursor: Option<String>,
    },
    Skills {
        cwd: Option<String>,
    },
    Plugins {
        cwd: Option<String>,
    },
    GoalGet {
        thread_id: String,
    },
    GoalSet {
        thread_id: String,
        objective: Option<String>,
        status: GoalStatus,
    },
    GoalClear {
        thread_id: String,
    },
    List {
        limit: Option<u64>,
        cursor: Option<String>,
        archived: bool,
        search: Option<String>,
    },
    Read {
        thread_id: String,
    },
    Compact {
        thread_id: String,
    },
    Start {
        cwd: Option<String>,
        model: Option<String>,
        access: AccessMode,
    },
    Resume {
        thread_id: String,
        access: AccessMode,
        cwd: Option<String>,
    },
    Fork {
        thread_id: String,
        turn_id: String,
        access: AccessMode,
        cwd: Option<String>,
    },
    Send {
        #[serde(default)]
        transfer_mode: super::upload_policy::TransferMode,
        thread_id: String,
        access: Option<AccessMode>,
        text: String,
        images: Vec<String>,
        #[serde(default)]
        skills: Vec<SkillInput>,
        #[serde(default)]
        attachments: Vec<AttachmentInput>,
        model: Option<String>,
        effort: Option<String>,
        cwd: Option<String>,
    },
    Interrupt {
        thread_id: String,
        turn_id: String,
    },
    Steer {
        #[serde(default)]
        transfer_mode: super::upload_policy::TransferMode,
        thread_id: String,
        turn_id: String,
        text: String,
        images: Vec<String>,
        #[serde(default)]
        skills: Vec<SkillInput>,
        #[serde(default)]
        attachments: Vec<AttachmentInput>,
    },
    SendBatch {
        thread_id: String,
        access: Option<AccessMode>,
        messages: Vec<PromptInput>,
        model: Option<String>,
        effort: Option<String>,
    },
    Rename {
        thread_id: String,
        name: String,
    },
    Archive {
        thread_id: String,
    },
    Unarchive {
        thread_id: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AccessMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Serialize)]
pub(crate) struct GuiResponse {
    pub(crate) data: Value,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiEvent {
    pub(crate) method: String,
    pub(crate) params: Value,
    pub(crate) id: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalReply {
    pub(crate) id: Value,
    pub(crate) decision: Option<Decision>,
    pub(crate) answers: Option<HashMap<String, Answer>>,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct Answer {
    pub(crate) answers: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Accept,
    Decline,
    Cancel,
}

pub(super) fn directory(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(GuiError::Directory);
    }
    path.canonicalize().map_err(|_| GuiError::Directory)
}

pub(super) fn id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 200
        || value
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(())
}

pub(super) fn thread_params(thread_id: String) -> Result<Value> {
    id(&thread_id)?;
    Ok(json!({"threadId": thread_id}))
}

impl GuiRequest {
    // Only this closed set of methods is exposed to the WebView.
    pub(super) fn into_rpc(self) -> Result<(&'static str, Value)> {
        match self {
            Self::DownloadBrowse(_) | Self::DownloadOpen(_) | Self::PreviewOpen(_) => {
                Err(GuiError::InvalidRequest)
            }
            Self::GenerateTitle(_) => Err(GuiError::InvalidRequest),
            Self::VideoOpen(_)
            | Self::VideoRead(_)
            | Self::VideoClose(_)
            | Self::FileOpen(_)
            | Self::FileRead(_)
            | Self::FileClose(_)
            | Self::FileManifest(_) => Err(GuiError::InvalidRequest),
            Self::ProjectFiles(_) => Err(GuiError::InvalidRequest),
            Self::ProjectDirectories { .. } => Err(GuiError::InvalidRequest),
            Self::TextPreview { .. } => Err(GuiError::InvalidRequest),
            Self::EditMessage(_) => Err(GuiError::InvalidRequest),
            // Image previews are served locally, never forwarded as an app-server operation.
            Self::ImagePreview { .. } => Err(GuiError::InvalidRequest),
            Self::Plugins { cwd } => {
                if let Some(cwd) = &cwd {
                    directory(cwd)?;
                }
                Ok((
                    "plugin/installed",
                    json!({"cwds": cwd.into_iter().collect::<Vec<_>>()}),
                ))
            }
            Self::GoalGet { thread_id } => Ok(("thread/goal/get", thread_params(thread_id)?)),
            Self::GoalClear { thread_id } => Ok(("thread/goal/clear", thread_params(thread_id)?)),
            Self::GoalSet {
                thread_id,
                objective,
                status,
            } => goals::set_params(thread_id, objective, status),
            Self::Skills { cwd } => {
                if let Some(cwd) = &cwd {
                    directory(cwd)?;
                }
                Ok((
                    "skills/list",
                    json!({"cwds": cwd.into_iter().collect::<Vec<_>>(), "forceReload": true}),
                ))
            }
            Self::Models { cursor } => {
                Ok(("model/list", json!({"limit": PAGE_SIZE, "cursor": cursor})))
            }
            Self::List {
                limit,
                cursor,
                archived,
                search,
            } => Ok((
                "thread/list",
                json!({
                    "limit": limit.unwrap_or(PAGE_SIZE).max(1),
                    "cursor": cursor, "archived": archived, "searchTerm": search,
                    "sortKey": "updated_at", "modelProviders": []
                }),
            )),
            Self::Start { cwd, model, access } => {
                let cwd = cwd.ok_or(GuiError::Directory)?;
                directory(&cwd)?;
                let mut params = json!({"cwd": cwd, "model": model});
                access.apply_to_thread(&mut params);
                Ok(("thread/start", params))
            }
            Self::Resume {
                thread_id,
                access,
                cwd,
            } => {
                let mut params = thread_params(thread_id)?;
                if let Some(cwd) = cwd {
                    directory(&cwd)?;
                    params["cwd"] = json!(cwd);
                }
                access.apply_to_thread(&mut params);
                Ok(("thread/resume", params))
            }
            Self::Read { thread_id } => {
                let mut params = thread_params(thread_id)?;
                params["includeTurns"] = json!(true);
                Ok(("thread/read", params))
            }
            Self::Fork {
                thread_id,
                turn_id,
                access,
                cwd,
            } => {
                id(&turn_id)?;
                let mut params = thread_params(thread_id)?;
                params["lastTurnId"] = json!(turn_id);
                // Forking opens a draft; an inherited goal must wait for the user's next message.
                params["deferGoalContinuation"] = json!(true);
                if let Some(cwd) = cwd {
                    directory(&cwd)?;
                    params["cwd"] = json!(cwd);
                }
                access.apply_to_thread(&mut params);
                Ok(("thread/fork", params))
            }
            Self::Send {
                transfer_mode,
                thread_id,
                access,
                text,
                images,
                skills,
                attachments,
                model,
                effort,
                cwd,
            } => send_params(
                thread_id,
                PromptInput {
                    transfer_mode,
                    text,
                    images,
                    skills,
                    attachments,
                },
                TurnOptions {
                    model,
                    effort,
                    cwd,
                    access,
                },
            ),
            Self::Interrupt { thread_id, turn_id } => {
                id(&turn_id)?;
                let mut params = thread_params(thread_id)?;
                params["turnId"] = json!(turn_id);
                Ok(("turn/interrupt", params))
            }
            Self::Steer {
                transfer_mode,
                thread_id,
                turn_id,
                text,
                images,
                skills,
                attachments,
            } => {
                id(&turn_id)?;
                let (_, mut params) = send_params(
                    thread_id,
                    PromptInput {
                        transfer_mode,
                        text,
                        images,
                        skills,
                        attachments,
                    },
                    TurnOptions {
                        model: None,
                        effort: None,
                        cwd: None,
                        access: None,
                    },
                )?;
                params["expectedTurnId"] = json!(turn_id);
                if let Some(object) = params.as_object_mut() {
                    object.remove("model");
                    object.remove("effort");
                }
                Ok(("turn/steer", params))
            }
            Self::SendBatch {
                thread_id,
                access,
                messages,
                model,
                effort,
            } => batch_params(
                thread_id,
                messages,
                TurnOptions {
                    model,
                    effort,
                    cwd: None,
                    access,
                },
            ),
            Self::Rename { thread_id, name } => {
                if name.trim().is_empty() || name.len() > 500 {
                    return Err(GuiError::InvalidRequest);
                }
                let mut params = thread_params(thread_id)?;
                params["name"] = json!(name.trim());
                Ok(("thread/name/set", params))
            }
            Self::Compact { thread_id } => Ok(("thread/compact/start", thread_params(thread_id)?)),
            Self::Archive { thread_id } => Ok(("thread/archive", thread_params(thread_id)?)),
            Self::Unarchive { thread_id } => Ok(("thread/unarchive", thread_params(thread_id)?)),
        }
    }
}

pub(super) fn approval_response(event: &GuiEvent, reply: ApprovalReply) -> Result<Value> {
    match event.method.as_str() {
        super::mcp_approval::METHOD => {
            super::mcp_approval::response(event, reply.decision.ok_or(GuiError::InvalidRequest)?)
        }
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            let decision = reply.decision.ok_or(GuiError::InvalidRequest)?;
            if let Some(available) = event.params["availableDecisions"].as_array() {
                if !available.contains(&json!(decision)) {
                    return Err(GuiError::InvalidRequest);
                }
            }
            Ok(json!({"decision": decision}))
        }
        "item/tool/requestUserInput" => {
            Ok(json!({"answers": reply.answers.ok_or(GuiError::InvalidRequest)?}))
        }
        "item/permissions/requestApproval" => {
            let permissions = match reply.decision.ok_or(GuiError::InvalidRequest)? {
                Decision::Accept => event.params["permissions"].clone(),
                Decision::Decline | Decision::Cancel => json!({}),
            };
            // Grant only the exact server-requested scope, never a frontend-supplied permission profile.
            Ok(json!({"permissions": permissions, "scope": "turn"}))
        }
        _ => Err(GuiError::InvalidRequest),
    }
}
