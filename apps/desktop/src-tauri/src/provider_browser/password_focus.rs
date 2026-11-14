use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PasswordFocus {
    origin: String,
    id: String,
    username: String,
    bounds: Bounds,
    viewport: Viewport,
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

impl PasswordFocus {
    pub(super) fn valid_for(&self, source: &str) -> bool {
        let Ok(url) = url::Url::parse(source) else {
            return false;
        };
        let bounds = &self.bounds;
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && self.origin == url.origin().ascii_serialization()
            && self.origin.len() <= 2048
            && !self.id.is_empty()
            && self.id.len() <= 80
            && self
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            && self.username.chars().count() <= 512
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
