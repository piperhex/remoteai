use super::{login, Error, Result};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub(crate) async fn open_claude_authorization<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    private_mode: bool,
) -> std::result::Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        launch(
            &url,
            private_mode,
            |url| {
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|_| Error::Browser)
            },
            crate::browser::try_open_default_private,
        )
    })
    .await
    .map_err(|_| Error::Browser.to_string())?
    .map_err(|error| error.to_string())
}

fn launch(
    url: &str,
    private_mode: bool,
    normal: impl FnOnce(&str) -> Result<()>,
    private: impl FnOnce(&str) -> bool,
) -> Result<bool> {
    if login::authorization_url(url).as_deref() != Some(url) {
        return Err(Error::Invalid);
    }
    if private_mode {
        return Ok(private(url));
    }
    normal(url).map(|()| true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_failure_never_opens_a_normal_window() {
        let url = super::super::oauth::pkce().unwrap().url;
        assert!(!launch(
            &url,
            true,
            |_| panic!("normal browser must not open"),
            |_| false
        )
        .unwrap());
        assert!(launch(
            &url,
            true,
            |_| panic!("normal browser must not open"),
            |_| true
        )
        .unwrap());
    }

    #[test]
    fn normal_mode_does_not_request_a_private_window() {
        let url = super::super::oauth::pkce().unwrap().url;
        assert!(launch(
            &url,
            false,
            |_| Ok(()),
            |_| panic!("private browser must not open")
        )
        .unwrap());
    }

    #[test]
    fn rejects_unrelated_and_embedded_authorization_urls() {
        let valid = super::super::oauth::pkce().unwrap().url;
        for url in [
            "https://example.com".to_string(),
            format!("https://example.com/?next={valid}"),
        ] {
            assert!(matches!(
                launch(&url, false, |_| panic!("invalid URL"), |_| false),
                Err(Error::Invalid)
            ));
        }
    }
}
