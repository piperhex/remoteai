//! Add image navigation only to explicitly requested browser resources, retaining their HTTP policy.
use super::{content, server, PreviewError, Result};
use std::path::Path;
use tiny_http::{Request, Response, ResponseBox};

const CHANNEL_PARAMETER: &str = "__preview_navigation";
const CHANNEL_PLACEHOLDER: &str = "__PREVIEW_NAVIGATION_CHANNEL__";

fn channel(request_url: &str) -> Option<String> {
    let (_, query) = request_url.split_once('?')?;
    let (_, value) =
        url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == CHANNEL_PARAMETER)?;
    Some(uuid::Uuid::parse_str(&value).ok()?.to_string())
}

pub(super) fn response(request: &Request, path: &Path) -> Result<Option<ResponseBox>> {
    if !matches!(content::extension(path).as_str(), "html" | "htm") {
        return Ok(None);
    }
    let Some(channel) = channel(request.url()) else {
        return Ok(None);
    };
    let data = content::load(path)?.ok_or(PreviewError::Read)?;
    let text = data.text.ok_or(PreviewError::Read)?;
    // The validated UUID cannot terminate the string or script element.
    let script =
        include_str!("navigation.js").replace(CHANNEL_PLACEHOLDER, &format!("\"{channel}\""));
    let html = format!("{text}\n<script>{script}</script>");
    let mut response = Response::from_data(html.into_bytes());
    for header in server::response_headers(path)? {
        response.add_header(header);
    }
    Ok(Some(response.boxed()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_channels_require_a_uuid_and_ignore_other_query_parameters() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            channel(&format!("/page.html?view=1&{CHANNEL_PARAMETER}={id}")),
            Some(id)
        );
        for value in [
            "/page.html",
            "/page.html?view=1",
            "/page.html?__preview_navigation=</script>",
        ] {
            assert_eq!(channel(value), None);
        }
    }
}
