use serde::{Deserialize, Serialize};

/// Pixel dimensions selected from the active display's supported modes.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HostPlatform {
    Windows,
    Macos,
}

/// Display identifiers come from host enumeration, never caller-provided native handles.
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct DisplayInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Opened {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolutions: Vec<Resolution>,
    #[serde(default)]
    pub platform: Option<HostPlatform>,
    #[serde(default)]
    pub native_only: bool,
    pub permissions: super::permissions::Permissions,
    pub id: String,
    pub displays: Vec<DisplayInfo>,
    pub display_id: String,
}

#[cfg(any(windows, target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(any(windows, target_os = "macos", test))]
impl Bounds {
    pub fn point(self, x: f64, y: f64) -> (i32, i32) {
        (
            self.x + (x * f64::from(self.width.saturating_sub(1))).round() as i32,
            self.y + (y * f64::from(self.height.saturating_sub(1))).round() as i32,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::Bounds;

    #[test]
    fn maps_corners_and_center_on_negative_and_portrait_displays() {
        let left = Bounds {
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
        };
        assert_eq!(left.point(0.0, 0.0), (-1920, -200));
        assert_eq!(left.point(1.0, 1.0), (-1, 879));
        assert_eq!(left.point(0.5, 0.5), (-960, 340));
        let portrait = Bounds {
            x: 2560,
            y: -1080,
            width: 1080,
            height: 1920,
        };
        assert_eq!(portrait.point(1.0, 1.0), (3639, 839));
    }

    #[test]
    fn retina_input_uses_logical_bounds_independently_of_stream_resolution() {
        let retina = Bounds {
            x: -1512,
            y: -200,
            width: 1512,
            height: 982,
        };
        // A 3024x1964 Retina screen still targets the same Quartz point at every stream quality.
        assert_eq!(retina.point(1.0, 1.0), (-1, 781));
        assert_eq!(retina.point(0.5, 0.5), (-756, 291));
    }
}
