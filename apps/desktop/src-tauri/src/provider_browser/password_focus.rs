use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PasswordFocus {
    origin: String,
    id: String,
    username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stage: Option<PasswordStage>,
    #[serde(
        rename = "continuationId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    continuation_id: Option<String>,
    bounds: Bounds,
    viewport: Viewport,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PasswordStage {
    Username,
    Password,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Viewport {
    width: f64,
    height: f64,
}

pub(super) fn valid_focus_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

impl PasswordFocus {
    pub(super) fn valid_for(&self, source: &str) -> bool {
        let Ok(url) = url::Url::parse(source) else {
            return false;
        };
        let bounds = &self.bounds;
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && self.origin == url.origin().ascii_serialization()
            && self.origin.len() <= 2048
            && valid_focus_id(&self.id)
            && self.username.chars().count() <= 512
            && (self.stage != Some(PasswordStage::Password) || !self.username.is_empty())
            && self
                .continuation_id
                .as_deref()
                .is_none_or(|id| self.stage == Some(PasswordStage::Password) && valid_focus_id(id))
            && [
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                self.viewport.width,
                self.viewport.height,
            ]
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 100_000.0)
            && bounds.width > 0.0
            && bounds.height > 0.0
            && self.viewport.width > 0.0
            && self.viewport.height > 0.0
    }
}
