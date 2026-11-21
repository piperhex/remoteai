use super::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Engine {
    Claude,
    Gemini,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct Request {
    engine: Engine,
    #[serde(flatten)]
    action: Action,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Action {
    Status,
    Install,
    Catalog {
        cwd: Option<String>,
        id: Option<String>,
    },
    List {
        archived: bool,
    },
    SyncList {
        archived: bool,
        search: Option<String>,
        more: Option<bool>,
        checkpoint: Option<DirectoryCheckpoint>,
    },
    Create {
        #[serde(default)]
        cwd: String,
        model: String,
        mode: Option<String>,
        effort: Option<String>,
    },
    Read {
        id: String,
        cursor: Option<Cursor>,
        #[serde(skip_serializing_if = "Option::is_none")]
        previews: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail_chunk: Option<DetailChunk>,
    },
    Send {
        id: String,
        text: String,
        message_id: String,
        model: Option<String>,
        effort: Option<String>,
        #[serde(default)]
        images: Vec<String>,
    },
    Image {
        id: String,
        source: String,
    },
    Stop {
        id: String,
    },
    Archive {
        id: String,
    },
    Approve {
        id: String,
        permission_id: String,
        action_id: String,
        answers: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
struct Cursor {
    epoch: String,
    seq: u64,
}

#[derive(Debug, Deserialize, Serialize)]
struct DetailChunk {
    token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    offset: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DirectoryCheckpoint {
    schema: u32,
    epoch: String,
    stream: String,
    scope: String,
    revision: u64,
}

fn bounded(value: &str, limit: usize) -> Result<()> {
    if value.is_empty() || value.len() > limit || value.contains('\0') {
        return Err(Error::Invalid);
    }
    Ok(())
}

fn directory(value: &str) -> Result<()> {
    let path = std::path::Path::new(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(Error::Invalid);
    }
    Ok(())
}

impl Request {
    pub(super) fn validate(self) -> Result<Self> {
        match &self.action {
            Action::SyncList {
                search, checkpoint, ..
            } => {
                if search
                    .as_ref()
                    .is_some_and(|value| value.len() > 4000 || value.contains('\0'))
                {
                    return Err(Error::Invalid);
                }
                if let Some(checkpoint) = checkpoint {
                    bounded(&checkpoint.epoch, 200)?;
                    bounded(&checkpoint.stream, 200)?;
                    bounded(&checkpoint.scope, 5000)?;
                }
            }
            Action::Create {
                cwd,
                model,
                mode,
                effort,
            } => {
                if !cwd.trim().is_empty() {
                    directory(cwd)?;
                }
                bounded(model, 300)?;
                if let Some(effort) = effort {
                    bounded(effort, 50)?;
                }
                if let Some(mode) = mode {
                    bounded(mode, 300)?;
                }
            }
            Action::Catalog { cwd, id } => {
                if let Some(cwd) = cwd {
                    directory(cwd)?;
                }
                if let Some(id) = id {
                    bounded(id, 200)?;
                }
            }
            Action::Send {
                id,
                text,
                message_id,
                model,
                effort,
                images,
            } => {
                bounded(id, 200)?;
                validate_images(images)?;
                if text.len() > 1_000_000
                    || text.contains('\0')
                    || (text.trim().is_empty() && images.is_empty())
                {
                    return Err(Error::Invalid);
                }
                bounded(message_id, 200)?;
                if let Some(model) = model {
                    bounded(model, 300)?;
                }
                if let Some(effort) = effort {
                    bounded(effort, 50)?;
                }
            }
            Action::Read {
                id,
                cursor,
                detail_id,
                detail_chunk,
                previews,
            } => {
                bounded(id, 200)?;
                if let Some(detail_id) = detail_id {
                    bounded(detail_id, 256)?;
                }
                if let Some(chunk) = detail_chunk {
                    if detail_id.is_none() || *previews == Some(true) {
                        return Err(Error::Invalid);
                    }
                    bounded(&chunk.token, 200)?;
                }
                if let Some(cursor) = cursor {
                    bounded(&cursor.epoch, 200)?;
                }
            }
            Action::Stop { id } | Action::Archive { id } => bounded(id, 200)?,
            Action::Image { id, source } => {
                bounded(id, 200)?;
                let digest = source.strip_prefix("chat-image://").ok_or(Error::Invalid)?;
                if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(Error::Invalid);
                }
            }
            Action::Approve {
                id,
                permission_id,
                action_id,
                answers,
            } => {
                bounded(id, 200)?;
                bounded(permission_id, 200)?;
                bounded(action_id, 500)?;
                if let Some(answers) = answers {
                    if answers.len() > 20 {
                        return Err(Error::Invalid);
                    }
                    for (key, value) in answers {
                        bounded(key, 4000)?;
                        bounded(value, 20_000)?;
                    }
                }
            }
            _ => {}
        }
        Ok(self)
    }
}

fn validate_images(images: &[String]) -> Result<()> {
    const MAX_IMAGES: usize = 8;
    const MAX_IMAGE_CHARS: usize = 6 * 1024 * 1024;
    if images.len() > MAX_IMAGES || images.iter().map(String::len).sum::<usize>() > MAX_IMAGE_CHARS
    {
        return Err(Error::Invalid);
    }
    for image in images {
        let (header, data) = image.split_once(',').ok_or(Error::Invalid)?;
        if !matches!(
            header,
            "data:image/png;base64"
                | "data:image/jpeg;base64"
                | "data:image/webp;base64"
                | "data:image/gif;base64"
        ) || data.is_empty()
            || data.len() > MAX_IMAGE_CHARS
            || !data
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        {
            return Err(Error::Invalid);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn directory_requests_preserve_scope_and_applied_checkpoint() {
        let value = json!({"engine":"claude", "action":"syncList", "archived":false,
        "search":"project", "more":true, "checkpoint":{
            "schema":1, "epoch":"worker", "stream":"view", "scope":"query", "revision":42
        }});
        let request: Request = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(request.validate().unwrap()).unwrap(),
            value
        );
    }

    #[test]
    fn directory_requests_reject_unbounded_or_empty_identifiers() {
        let value = json!({"engine":"gemini", "action":"syncList", "archived":false,
            "checkpoint":{"schema":1, "epoch":"", "stream":"view", "scope":"query", "revision":0}});
        assert!(serde_json::from_value::<Request>(value)
            .unwrap()
            .validate()
            .is_err());
        let value = json!({"engine":"gemini", "action":"syncList", "archived":false,
            "search":"x".repeat(4001)});
        assert!(serde_json::from_value::<Request>(value)
            .unwrap()
            .validate()
            .is_err());
    }

    #[test]
    fn preserves_images_and_allows_image_only_messages() {
        for engine in ["claude", "gemini"] {
            let value = json!({"engine":engine,"action":"send","id":"agent",
                "messageId":"message", "text":"", "images":["data:image/png;base64,aGVsbG8="]});
            let request: Request = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(request.validate().unwrap()).unwrap()["images"],
                value["images"]
            );
        }
    }

    #[test]
    fn rejects_invalid_image_messages_and_image_paths() {
        for images in [
            json!([]),
            json!(["https://example.com/image.png"]),
            json!(["data:image/svg+xml;base64,aGVsbG8="]),
            json!(vec!["data:image/png;base64,aGVsbG8="; 9]),
        ] {
            let request: Request =
                serde_json::from_value(json!({"engine":"claude","action":"send",
                "id":"agent","messageId":"message","text":"","images":images}))
                .unwrap();
            assert!(request.validate().is_err());
        }
        let request: Request = serde_json::from_value(json!({"engine":"gemini","action":"image",
            "id":"agent","source":"../../secret.png"}))
        .unwrap();
        assert!(request.validate().is_err());
    }

    #[test]
    fn rejects_arbitrary_engines_actions_and_directories() {
        for value in [
            json!({"engine":"shell","action":"status"}),
            json!({"engine":"claude","action":"execute","command":"anything"}),
        ] {
            assert!(serde_json::from_value::<Request>(value).is_err());
        }
        let request: Request = serde_json::from_value(json!({"engine":"gemini","action":"create",
            "cwd":"../outside", "model":"auto"}))
        .unwrap();
        assert!(request.validate().is_err());
    }

    #[test]
    fn preserves_exact_provider_permission_choices() {
        let value = json!({"engine":"gemini","action":"approve","id":"agent_1",
            "permissionId":"permission_2","actionId":"allow-once:exact"});
        let request: Request = serde_json::from_value(value).unwrap();
        let serialized = serde_json::to_value(request.validate().unwrap()).unwrap();
        assert_eq!(serialized["actionId"], "allow-once:exact");
    }

    #[test]
    fn forwards_history_previews_and_exact_detail_reads_to_the_worker() {
        let read =
            json!({"engine":"claude","action":"read","id":"agent","cursor":{"epoch":"e","seq":7}});
        for (field, value) in [("previews", json!(true)), ("detailId", json!("entry-7"))] {
            let mut body = read.clone();
            body[field] = value;
            let request: Request = serde_json::from_value(body.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(request.validate().unwrap()).unwrap(),
                body
            );
        }
        let request: Request = serde_json::from_value(read.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(request.validate().unwrap()).unwrap(),
            read
        );
    }

    #[test]
    fn forwards_chunk_offsets_and_explicit_release_for_the_requested_history_entry() {
        let read = json!({"engine":"gemini","action":"read","id":"agent","cursor":null,"detailId":"entry"});
        for part in [
            json!({"token":"lease","offset":0}),
            json!({"token":"lease"}),
        ] {
            let mut body = read.clone();
            body["detailChunk"] = part;
            let request: Request = serde_json::from_value(body.clone()).unwrap();
            assert_eq!(
                serde_json::to_value(request.validate().unwrap()).unwrap(),
                body
            );
        }
        let invalid =
            json!({"engine":"gemini","action":"read","id":"agent","detailChunk":{"token":"lease"}});
        assert!(serde_json::from_value::<Request>(invalid)
            .unwrap()
            .validate()
            .is_err());
    }

    #[test]
    fn preserves_catalog_session_binding() {
        let request: Request =
            serde_json::from_value(json!({"engine":"claude", "action":"catalog",
            "id":"existing-session"}))
            .unwrap();
        assert_eq!(
            serde_json::to_value(request.validate().unwrap()).unwrap()["id"],
            "existing-session"
        );
    }

    #[test]
    fn accepts_projectless_create_without_weakening_explicit_directory_checks() {
        for engine in ["claude", "gemini"] {
            for cwd in [None, Some(""), Some("   ")] {
                let mut value =
                    json!({"engine": engine, "action": "create", "model": "account-model"});
                if let Some(cwd) = cwd {
                    value["cwd"] = json!(cwd);
                }
                let request: Request = serde_json::from_value(value).unwrap();
                assert!(request.validate().is_ok());
            }
            let value = json!({"engine": engine, "action": "create", "cwd": "relative", "model": "account-model"});
            assert!(serde_json::from_value::<Request>(value)
                .unwrap()
                .validate()
                .is_err());
        }
    }
}
