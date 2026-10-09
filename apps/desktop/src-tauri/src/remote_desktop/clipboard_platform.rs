use super::clipboard::{ClipboardError, ClipboardResult, Content, Shortcut, MAX_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{borrow::Cow, io::Cursor};

const MAX_IMAGE_DIMENSION: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;

pub(super) fn read(
    session: &mut super::Session,
    shortcut: Option<Shortcut>,
) -> ClipboardResult<Content> {
    if let Some(shortcut) = shortcut {
        copy_selection(session, shortcut)?;
    }
    read_local()
}

pub(super) fn read_local() -> ClipboardResult<Content> {
    let mut clipboard = arboard::Clipboard::new().map_err(|_| ClipboardError::Access)?;
    if let Ok(paths) = clipboard.get().file_list() {
        if !paths.is_empty() {
            return Ok(Content::Files {
                files: super::clipboard_files::read(paths)?,
            });
        }
    }
    if let Ok(image) = clipboard.get_image() {
        return encode_image(image);
    }
    let text = clipboard.get_text().map_err(|_| ClipboardError::Access)?;
    if text.len() > MAX_BYTES {
        return Err(ClipboardError::Size);
    }
    Ok(Content::Text { text })
}

fn encode_image(image: arboard::ImageData<'_>) -> ClipboardResult<Content> {
    if image.width as u64 * image.height as u64 > MAX_IMAGE_PIXELS {
        return Err(ClipboardError::Size);
    }
    let mut bytes = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut bytes),
        &image.bytes,
        image.width as u32,
        image.height as u32,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|_| ClipboardError::Invalid)?;
    if bytes.len() > MAX_BYTES {
        return Err(ClipboardError::Size);
    }
    Ok(Content::Image {
        data: STANDARD.encode(bytes),
    })
}

fn decode_image(data: String) -> ClipboardResult<arboard::ImageData<'static>> {
    if data.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err(ClipboardError::Size);
    }
    let bytes = STANDARD.decode(data).map_err(|_| ClipboardError::Invalid)?;
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_IMAGE_PIXELS * 4);
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    reader.limits(limits);
    let pixels = reader
        .decode()
        .map_err(|_| ClipboardError::Invalid)?
        .into_rgba8();
    if u64::from(pixels.width()) * u64::from(pixels.height()) > MAX_IMAGE_PIXELS {
        return Err(ClipboardError::Size);
    }
    Ok(arboard::ImageData {
        width: pixels.width() as usize,
        height: pixels.height() as usize,
        bytes: Cow::Owned(pixels.into_raw()),
    })
}

pub(super) fn write(
    session: &mut super::Session,
    content: Content,
    paste: bool,
) -> ClipboardResult<()> {
    write_local(content)?;
    if paste {
        paste_selection(session)?;
    }
    Ok(())
}

pub(super) fn write_local(content: Content) -> ClipboardResult<()> {
    let mut clipboard = arboard::Clipboard::new().map_err(|_| ClipboardError::Access)?;
    match content {
        Content::Text { text } => {
            if text.len() > MAX_BYTES || text.contains('\0') {
                return Err(ClipboardError::Size);
            }
            clipboard
                .set_text(text)
                .map_err(|_| ClipboardError::Access)?;
        }
        Content::Image { data } => clipboard
            .set_image(decode_image(data)?)
            .map_err(|_| ClipboardError::Access)?,
        Content::Files { files } => {
            let paths = super::clipboard_files::write(files)?;
            clipboard
                .set()
                .file_list(&paths)
                .map_err(|_| ClipboardError::Access)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn copy_selection(session: &mut super::Session, shortcut: Shortcut) -> ClipboardResult<()> {
    use windows_sys::Win32::{
        System::DataExchange::GetClipboardSequenceNumber,
        UI::Input::KeyboardAndMouse::{VK_C, VK_X},
    };
    session
        .input
        .release()
        .map_err(|_| ClipboardError::Access)?;
    // SAFETY: This Win32 call reads a process-independent clipboard counter and takes no pointers.
    let before = unsafe { GetClipboardSequenceNumber() };
    let code = match shortcut {
        Shortcut::Copy => VK_C,
        Shortcut::Cut => VK_X,
    };
    super::windows_input::clipboard_shortcut(code).map_err(|_| ClipboardError::Access)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while std::time::Instant::now() < deadline {
        // SAFETY: same parameter-free clipboard counter read as above.
        if unsafe { GetClipboardSequenceNumber() } != before {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    Err(ClipboardError::Copy)
}

#[cfg(windows)]
fn paste_selection(session: &mut super::Session) -> ClipboardResult<()> {
    session
        .input
        .release()
        .map_err(|_| ClipboardError::Access)?;
    super::windows_input::clipboard_shortcut(windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_V)
        .map_err(|_| ClipboardError::Access)
}
#[cfg(target_os = "macos")]
fn copy_selection(session: &mut super::Session, shortcut: Shortcut) -> ClipboardResult<()> {
    let before = super::macos::pasteboard::change_count()?;
    let key = match shortcut {
        Shortcut::Copy => 8,
        Shortcut::Cut => 7,
    };
    session
        .input
        .chord(&[55, key])
        .map_err(|_| ClipboardError::Access)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while std::time::Instant::now() < deadline {
        if super::macos::pasteboard::change_count()? != before {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    Err(ClipboardError::Copy)
}

#[cfg(target_os = "macos")]
fn paste_selection(session: &mut super::Session) -> ClipboardResult<()> {
    session
        .input
        .chord(&[55, 9])
        .map_err(|_| ClipboardError::Access)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn copy_selection(_: &mut super::Session, _: Shortcut) -> ClipboardResult<()> {
    Err(ClipboardError::Access)
}
#[cfg(not(any(windows, target_os = "macos")))]
fn paste_selection(_: &mut super::Session) -> ClipboardResult<()> {
    Err(ClipboardError::Access)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_roundtrip_preserves_pixels_and_rejects_non_png_data() {
        let original = arboard::ImageData {
            width: 1,
            height: 1,
            bytes: Cow::Owned(vec![1, 2, 3, 255]),
        };
        let Content::Image { data } = encode_image(original).unwrap() else {
            panic!("image expected")
        };
        assert_eq!(decode_image(data).unwrap().bytes.as_ref(), &[1, 2, 3, 255]);
        assert!(decode_image(STANDARD.encode("not an image")).is_err());
    }
}
