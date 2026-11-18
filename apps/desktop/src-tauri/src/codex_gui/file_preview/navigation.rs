//! Add image navigation only to explicitly requested browser resources, retaining their HTTP policy.
use super::{content, server, PreviewError, Result};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
};
use tiny_http::{Request, Response, ResponseBox, StatusCode};

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
    // The validated UUID cannot terminate the string or script element.
    let script =
        include_str!("navigation.js").replace(CHANNEL_PLACEHOLDER, &format!("\"{channel}\""));
    let script = format!("\n<script>{script}</script>");
    let file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut reader = BufReader::new(file.take(size));
    let suffix = match reader.fill_buf()? {
        [0xff, 0xfe, ..] => script.encode_utf16().flat_map(u16::to_le_bytes).collect(),
        [0xfe, 0xff, ..] => script.encode_utf16().flat_map(u16::to_be_bytes).collect(),
        _ => script.into_bytes(),
    };
    let length = usize::try_from(size)
        .ok()
        .and_then(|n| n.checked_add(suffix.len()))
        .ok_or(PreviewError::Read)?;
    let response = Response::new(
        StatusCode(200),
        server::response_headers(path)?,
        reader.chain(std::io::Cursor::new(suffix)),
        Some(length),
        None,
    );
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
