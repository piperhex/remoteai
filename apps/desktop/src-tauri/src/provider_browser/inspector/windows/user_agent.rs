use super::super::DevicePreset;
use super::{BrowserError, Result};
use crate::provider_browser::automation::devtools;
use serde_json::{json, Value};
use tauri::Webview;

const MOBILE_SAFARI: &str = "Mobile/15E148 Safari/604.1";

struct Profile {
    agent: String,
    platform: &'static str,
    hints: Option<Value>,
}

fn safari(system: &str, suffix: &str, platform: &'static str) -> Profile {
    let engine = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5";
    // Safari does not send Chromium UA Client Hints.
    Profile {
        agent: format!("Mozilla/5.0 ({system}) {engine} {suffix}"),
        platform,
        hints: None,
    }
}

fn hints(platform: &str, os: &str, model: &str, mobile: bool) -> Value {
    json!({ "platform": platform, "platformVersion": os, "model": model, "mobile": mobile,
        "architecture": "", "bitness": "" })
}

fn chrome(system: &str, suffix: &str, platform: &'static str, hints: Value) -> Profile {
    let engine = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/%s";
    Profile {
        agent: format!("Mozilla/5.0 ({system}) {engine} {suffix}"),
        platform,
        hints: Some(hints),
    }
}

fn android(os: &str, model: &str) -> Profile {
    let token = if model.is_empty() { "K" } else { model };
    chrome(
        &format!("Linux; Android {os}; {token}"),
        "Mobile Safari/537.36",
        "Linux armv8l",
        hints("Android", os, model, true),
    )
}

/// The same device identities as the Chrome DevTools EmulatedDevices catalog.
fn profile(preset: DevicePreset) -> Profile {
    use DevicePreset::*;
    match preset {
        IPhone => safari(
            "iPhone; CPU iPhone OS 18_5 like Mac OS X",
            MOBILE_SAFARI,
            "iPhone",
        ),
        IPadMini => safari("iPad; CPU OS 18_5 like Mac OS X", MOBILE_SAFARI, "iPad"),
        IPadPro => safari(
            "Macintosh; Intel Mac OS X 10_15_7",
            "Safari/605.1.15",
            "MacIntel",
        ),
        Pixel9 => android("14", "Pixel 9"),
        Pixel9Pro => android("14", "Pixel 9 Pro"),
        Pixel10 => android("16", "Pixel 10"),
        Pixel9ProFold => android("14", "Pixel 9 Pro Fold"),
        GalaxyA55 => android("14", "SM-A556B"),
        GalaxyZFold6 => android("14", "SM-F956U"),
        Responsive => android("10", ""),
        SurfacePro => chrome(
            "Windows NT 10.0; Win64; x64",
            "Safari/537.36",
            "Win32",
            hints("Windows", "", "Surface Pro 10", false),
        ),
        NestHubMax => chrome(
            "X11; Linux aarch64",
            "Safari/537.36 CrKey/1.54.250320",
            "Linux aarch64",
            hints("Linux", "", "Nest Hub Max", false),
        ),
    }
}

async fn browser_version(view: &Webview) -> Result<String> {
    let reply = devtools::call(view, "Browser.getVersion", json!({}))
        .await
        .map_err(|_| BrowserError::Unavailable)?;
    reply["userAgent"]
        .as_str()
        .and_then(|ua| {
            ua.split_ascii_whitespace()
                .find_map(|token| token.strip_prefix("Chrome/"))
        })
        .map(String::from)
        .ok_or(BrowserError::Unavailable)
}

pub(super) async fn parameters(
    view: &Webview,
    preset: Option<DevicePreset>,
    cached_version: &mut Option<String>,
) -> Result<Value> {
    let Some(preset) = preset else {
        return Ok(json!({"userAgent": ""}));
    };
    let profile = profile(preset);
    let mut params = json!({"userAgent": profile.agent, "platform": profile.platform});
    if let Some(mut metadata) = profile.hints {
        let version = match cached_version {
            Some(version) => version,
            None => cached_version.insert(browser_version(view).await?),
        };
        let major = version.split('.').next().unwrap_or(version);
        metadata["brands"] = json!([{"brand": "Chromium", "version": major}]);
        metadata["fullVersionList"] = json!([{"brand": "Chromium", "version": version}]);
        metadata["fullVersion"] = json!(version);
        params["userAgentMetadata"] = metadata;
        params["userAgent"] = json!(profile.agent.replace("%s", version));
    }
    Ok(params)
}
