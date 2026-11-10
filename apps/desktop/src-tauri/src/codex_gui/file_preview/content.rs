//! File detection and bounded text decoding; binary media is streamed separately.
use super::{PreviewError, Result};
use serde::Serialize;
use std::{fs::File, io::Read, path::Path};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
// Matches the largest selectable JSON highlight limit in shared/file-preview/jsonHighlightLimit.ts.
const MAX_JSON_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum PreviewKind {
    Html,
    Markdown,
    Text,
    Image,
    Pdf,
    Video,
    Audio,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewData {
    pub(super) session_id: String,
    pub(super) path: String,
    pub(super) name: String,
    pub(super) kind: PreviewKind,
    pub(super) text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) size: Option<u64>,
    pub(super) url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) column: Option<u32>,
}

pub(super) fn load(path: &Path) -> Result<Option<PreviewData>> {
    if !path.is_file() {
        return Ok(None);
    }
    let kind = if matches!(extension(path).as_str(), "ts" | "mts") && is_transport_stream(path)? {
        PreviewKind::Video
    } else {
        kind(path)
    };
    let (text, size) = if matches!(
        kind,
        PreviewKind::Html | PreviewKind::Markdown | PreviewKind::Text
    ) {
        let Some((text, size)) = read_text(path)? else {
            return Ok(None);
        };
        (Some(text), Some(size))
    } else {
        (None, Some(std::fs::metadata(path)?.len()))
    };
    Ok(Some(PreviewData {
        session_id: String::new(),
        path: super::super::platform::execution_path(path),
        name: path
            .file_name()
            .ok_or(PreviewError::Read)?
            .to_string_lossy()
            .into_owned(),
        kind,
        text,
        size,
        url: String::new(),
        line: None,
        column: None,
    }))
}

fn kind(path: &Path) -> PreviewKind {
    match extension(path).as_str() {
        "html" | "htm" | "xhtml" => PreviewKind::Html,
        "md" | "markdown" | "mdown" | "mkd" | "mdx" => PreviewKind::Markdown,
        "png" | "jpg" | "jpeg" | "jfif" | "gif" | "webp" | "bmp" | "avif" | "svg" | "ico"
        | "apng" => PreviewKind::Image,
        "pdf" => PreviewKind::Pdf,
        "mp4" | "m4v" | "webm" | "ogv" | "ogg" | "mov" | "mkv" | "avi" | "mpeg" | "mpg" | "3gp"
        | "3g2" | "m2ts" | "wmv" | "flv" => PreviewKind::Video,
        "mp3" | "wav" | "wave" | "m4a" | "aac" | "flac" | "oga" | "opus" | "aif" | "aiff"
        | "weba" => PreviewKind::Audio,
        _ => PreviewKind::Text,
    }
}

// TypeScript and MPEG transport streams share .ts/.mts extensions.
fn is_transport_stream(path: &Path) -> Result<bool> {
    let mut sample = Vec::new();
    File::open(path)?.take(400).read_to_end(&mut sample)?;
    Ok(
        (sample.first() == Some(&0x47) && sample.get(188) == Some(&0x47))
            || (sample.get(4) == Some(&0x47) && sample.get(196) == Some(&0x47)),
    )
}

fn read_text(path: &Path) -> Result<Option<(String, u64)>> {
    let limit = match extension(path).as_str() {
        "json" | "jsonc" | "json5" | "geojson" | "ipynb" => MAX_JSON_BYTES,
        _ => MAX_TEXT_BYTES,
    };
    let file = File::open(path)?;
    if file.metadata()?.len() > limit {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    let size = bytes.len() as u64;
    if size > limit {
        return Ok(None);
    }
    Ok(decode_text(&bytes).map(|text| (text, size)))
}

fn decode_text(bytes: &[u8]) -> Option<String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        if !bytes.len().is_multiple_of(2) {
            return None;
        }
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| {
                if little {
                    u16::from_le_bytes(*pair)
                } else {
                    u16::from_be_bytes(*pair)
                }
            })
            .collect();
        String::from_utf16(&units).ok()?
    } else {
        std::str::from_utf8(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
            .ok()?
            .to_owned()
    };
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\u{c}'))
    {
        return None;
    }
    Some(text)
}

pub(super) fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

#[cfg(test)]
#[path = "content_tests.rs"]
mod file_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_decoding_accepts_boms_but_rejects_binary_and_broken_encodings() {
        assert_eq!(decode_text(b"\xef\xbb\xbfhello\n"), Some("hello\n".into()));
        assert_eq!(decode_text(&[0xff, 0xfe, 0x2d, 0x4e]), Some("中".into()));
        assert_eq!(decode_text(&[0xfe, 0xff, 0x4e, 0x2d]), Some("中".into()));
        for bytes in [
            b"a\0b".as_slice(),
            &[0xff],
            &[0xff, 0xfe, 1],
            &[0xff, 0xfe, 0, 0xd8],
        ] {
            assert_eq!(decode_text(bytes), None);
        }
        assert_eq!(decode_text(b""), Some(String::new()));
    }
}
