//! Authorized text and image snapshots share file manifests, binary transport and range reads.
use std::sync::Arc;

use serde::Deserialize;

use super::{
    client::Client,
    error::{GuiError, Result},
    file_stream::FileStreams,
    image_preview::{self, PreviewOptions},
    image_thumbnail::ImageVariant,
    protocol::GuiResponse,
    text_preview,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PreviewKind {
    Text,
    Thumbnail,
    Image,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Open {
    pub transfer_id: String,
    pub thread_id: String,
    pub path: String,
    pub preview: PreviewKind,
    pub max_bytes: u64,
}

pub(super) async fn open(
    client: &Client,
    streams: Arc<FileStreams>,
    options: Open,
) -> Result<GuiResponse> {
    uuid::Uuid::parse_str(&options.transfer_id).map_err(|_| GuiError::InvalidRequest)?;
    uuid::Uuid::parse_str(&options.thread_id).map_err(|_| GuiError::InvalidRequest)?;
    if options.max_bytes == 0 {
        return Err(GuiError::InvalidRequest);
    }
    // Reuse the exact workspace / recorded-reference and public-URL authorization of existing previews.
    let response = match options.preview {
        PreviewKind::Text => {
            text_preview::preview(
                client,
                options.thread_id,
                options.path,
                Some(options.max_bytes),
            )
            .await?
        }
        PreviewKind::Thumbnail | PreviewKind::Image => {
            image_preview::preview(
                client,
                options.thread_id,
                options.path,
                PreviewOptions {
                    variant: if matches!(options.preview, PreviewKind::Thumbnail) {
                        ImageVariant::Thumbnail
                    } else {
                        ImageVariant::Original
                    },
                    max_bytes: Some(options.max_bytes),
                },
            )
            .await?
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, name, mime) = snapshot_content(response, options.preview, options.max_bytes)?;
        streams.insert_preview(options.transfer_id, &bytes, name, mime)
    })
    .await
    .map_err(|_| GuiError::FileRead)?
}

fn snapshot_content(
    response: GuiResponse,
    kind: PreviewKind,
    max_bytes: u64,
) -> Result<(Vec<u8>, String, String)> {
    if matches!(kind, PreviewKind::Text) {
        let text = response.data["text"]
            .as_str()
            .ok_or(GuiError::TextPreview)?;
        return Ok((
            text.as_bytes().to_vec(),
            "preview.txt".into(),
            "text/plain;charset=utf-8".into(),
        ));
    }
    let url = response.data["url"]
        .as_str()
        .ok_or(GuiError::ImagePreview)?;
    let limit = if matches!(kind, PreviewKind::Thumbnail) {
        max_bytes.max(super::image_thumbnail::MAX_THUMBNAIL_BYTES as u64)
    } else {
        max_bytes
    };
    let bytes = super::images::decode_data_url(url, limit)?;
    let (extension, mime) = match image::guess_format(&bytes).map_err(|_| GuiError::ImagePreview)? {
        image::ImageFormat::Png => ("png", "image/png"),
        image::ImageFormat::Jpeg => ("jpg", "image/jpeg"),
        image::ImageFormat::WebP => ("webp", "image/webp"),
        image::ImageFormat::Gif => ("gif", "image/gif"),
        _ => return Err(GuiError::ImagePreview),
    };
    Ok((bytes, format!("image.{extension}"), mime.into()))
}
