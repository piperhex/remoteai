use serde::{Deserialize, Serialize};

const MAX_MODEL_LENGTH: usize = 128;

/// Shared contract for server-provided settings and conversation title requests.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TitleSettings {
    pub(crate) model: String,
    pub(crate) effort: TitleEffort,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TitleEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl Default for TitleSettings {
    fn default() -> Self {
        Self {
            model: "gpt-5.6-luna".into(),
            effort: TitleEffort::Low,
        }
    }
}

impl TitleSettings {
    pub(crate) fn is_valid(&self) -> bool {
        self.model.len() <= MAX_MODEL_LENGTH
            && self.model.starts_with(|c: char| c.is_ascii_alphanumeric())
            && self
                .model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._:/-".contains(c))
    }
}
