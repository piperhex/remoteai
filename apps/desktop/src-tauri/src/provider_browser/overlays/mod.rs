//! A trusted, same-origin popup hosts React portals above native browser children.
//! Web pages never receive the popup's opening ticket or application IPC access.
use serde::Deserialize;
use tauri::Webview;

#[cfg(windows)]
mod windows;

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Region {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Placement {
    regions: Vec<Region>,
    scale: f64,
}

impl Placement {
    fn valid(&self) -> bool {
        self.regions.len() <= 128
            && self.scale.is_finite()
            && (0.5..=8.0).contains(&self.scale)
            && self.regions.iter().all(|region| {
                [region.x, region.y, region.width, region.height]
                    .iter()
                    .all(|value| value.is_finite() && (0.0..=32_768.0).contains(value))
            })
    }
}

#[tauri::command]
pub(crate) async fn browser_overlay_prepare(webview: Webview) -> Result<Option<String>, String> {
    if webview.label() != "main" {
        return Err("market.invalid".into());
    }
    #[cfg(windows)]
    return windows::prepare(webview).await.map(Some);
    #[cfg(not(windows))]
    Ok(None)
}

#[tauri::command]
pub(crate) async fn browser_overlay_place(
    webview: Webview,
    placement: Placement,
) -> Result<(), String> {
    if webview.label() != "main" || !placement.valid() {
        return Err("market.invalid".into());
    }
    #[cfg(windows)]
    return windows::place(webview, placement).await;
    #[cfg(not(windows))]
    Ok(())
}

#[tauri::command]
pub(crate) async fn browser_overlay_focus(webview: Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("market.invalid".into());
    }
    #[cfg(windows)]
    return windows::focus(webview).await;
    #[cfg(not(windows))]
    Ok(())
}

#[cfg(all(test, windows))]
#[tauri::command]
pub(crate) async fn fixture_size(webview: Webview, width: f64, height: f64) -> Result<(), String> {
    if !(600.0..=1920.0).contains(&width) || !(500.0..=1200.0).contains(&height) {
        return Err("invalid fixture size".into());
    }
    webview
        .window()
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbounded_native_regions_and_invalid_scale() {
        let mut placement = Placement {
            regions: vec![],
            scale: 1.0,
        };
        assert!(placement.valid());
        placement.scale = f64::NAN;
        assert!(!placement.valid());
        placement.scale = 1.0;
        placement.regions = vec![
            Region {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0
            };
            129
        ];
        assert!(!placement.valid());
        placement.regions.truncate(1);
        placement.regions[0].x = -1.0;
        assert!(!placement.valid());
    }
}
