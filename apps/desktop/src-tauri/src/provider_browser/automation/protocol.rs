use super::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Action {
    Open { url: String, request_id: String },
    List,
    Snapshot,
    Screenshot,
    Navigate { url: String },
    Back,
    Forward,
    Reload,
    Stop,
    Close,
    Click { reference: String },
    Type { reference: String, text: String },
    Select { reference: String, value: String },
    Scroll { x: i32, y: i32 },
    Key { key: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub thread_id: String,
    pub tab_id: Option<String>,
    #[serde(rename = "command")]
    pub action: Action,
}

pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

impl Request {
    pub(super) fn validate(&self) -> Result<()> {
        if !identifier(&self.thread_id) {
            return Err(Error::Invalid);
        }
        if !matches!(self.action, Action::Open { .. } | Action::List)
            && self
                .tab_id
                .as_ref()
                .is_none_or(|id| uuid::Uuid::parse_str(id).is_err())
        {
            return Err(Error::Invalid);
        }
        match &self.action {
            Action::Open { request_id, .. } if !identifier(request_id) => Err(Error::Invalid),
            Action::Type { text, .. } if text.len() > 16_000 => Err(Error::Invalid),
            Action::Select { value, .. } if value.len() > 4_000 => Err(Error::Invalid),
            Action::Click { reference }
            | Action::Type { reference, .. }
            | Action::Select { reference, .. }
                if reference.is_empty() || reference.len() > 100 =>
            {
                Err(Error::Invalid)
            }
            Action::Scroll { x, y } if x.unsigned_abs() > 10_000 || y.unsigned_abs() > 10_000 => {
                Err(Error::Invalid)
            }
            Action::Key { key }
                if !matches!(
                    key.as_str(),
                    "Enter"
                        | "Tab"
                        | "Escape"
                        | "ArrowDown"
                        | "ArrowUp"
                        | "ArrowLeft"
                        | "ArrowRight"
                        | "Backspace"
                        | "Delete"
                        | "Home"
                        | "End"
                ) =>
            {
                Err(Error::Invalid)
            }
            _ => Ok(()),
        }
    }
}
