#[cfg(target_os = "windows")]
use std::process::Command;

use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Opens a URL in the detected default browser's private browsing mode.
///
/// Windows does not expose a generic private-mode flag through the shell URL
/// handler, so the registered browser is resolved first and launched with its
/// documented command-line switch. Unknown browsers fall back to the normal
/// system URL handler.
pub(crate) fn open_default_private<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
) -> Result<(), String> {
    if try_open_default_private(url) {
        return Ok(());
    }

    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|error| format!("无法打开默认浏览器：{error}"))
}

/// A private-window request must let callers offer manual opening when the browser is unsupported.
pub(crate) fn try_open_default_private(url: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_default_browser()
            .is_some_and(|browser| launch_windows_private_browser(browser, url).is_ok())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        false
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowsBrowser {
    Chrome,
    Edge,
    Firefox,
}

#[cfg(target_os = "windows")]
fn windows_default_browser() -> Option<WindowsBrowser> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    let user_choice = current_user
        .open_subkey(
            "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
        )
        .ok()?;
    let prog_id: String = user_choice.get_value("ProgId").ok()?;
    browser_from_prog_id(&prog_id)
}

#[cfg(target_os = "windows")]
fn browser_from_prog_id(prog_id: &str) -> Option<WindowsBrowser> {
    let normalized = prog_id.to_ascii_lowercase();
    if normalized.contains("chrome") {
        return Some(WindowsBrowser::Chrome);
    }
    if normalized.contains("edge") || normalized.contains("microsoftedge") {
        return Some(WindowsBrowser::Edge);
    }
    if normalized.contains("firefox") {
        return Some(WindowsBrowser::Firefox);
    }
    None
}

#[cfg(target_os = "windows")]
fn launch_windows_private_browser(browser: WindowsBrowser, url: &str) -> Result<(), String> {
    let (switch, candidates) = windows_browser_candidates(browser);
    let mut last_error = None;
    for executable in candidates {
        let mut command = Command::new(&executable);
        use std::os::windows::process::CommandExt;
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
        match command.args([switch, url]).spawn() {
            Ok(_) => return Ok(()),
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(last_error.unwrap_or_else(|| "未找到可用的浏览器程序".to_string()))
}

#[cfg(target_os = "windows")]
fn windows_browser_candidates(browser: WindowsBrowser) -> (&'static str, Vec<String>) {
    let (switch, executable, locations): (&str, &str, &[&str]) = match browser {
        WindowsBrowser::Chrome => (
            "--incognito",
            "chrome.exe",
            &[
                "Google\\Chrome\\Application\\chrome.exe",
                "Google\\Chrome Beta\\Application\\chrome.exe",
            ],
        ),
        WindowsBrowser::Edge => (
            "--inprivate",
            "msedge.exe",
            &["Microsoft\\Edge\\Application\\msedge.exe"],
        ),
        WindowsBrowser::Firefox => (
            "-private-window",
            "firefox.exe",
            &["Mozilla Firefox\\firefox.exe"],
        ),
    };
    let mut candidates = vec![executable.to_string()];
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Some(root) = std::env::var_os(variable) {
            for location in locations {
                candidates.push(
                    std::path::Path::new(&root)
                        .join(location)
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
    }
    (switch, candidates)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{browser_from_prog_id, WindowsBrowser};

    #[test]
    fn recognizes_supported_windows_browser_ids() {
        assert_eq!(
            browser_from_prog_id("ChromeHTML"),
            Some(WindowsBrowser::Chrome)
        );
        assert_eq!(
            browser_from_prog_id("MSEdgeHTM"),
            Some(WindowsBrowser::Edge)
        );
        assert_eq!(
            browser_from_prog_id("FirefoxURL-308046B0"),
            Some(WindowsBrowser::Firefox)
        );
    }

    #[test]
    fn ignores_unknown_browser_ids() {
        assert_eq!(browser_from_prog_id("BraveHTML"), None);
    }
}
