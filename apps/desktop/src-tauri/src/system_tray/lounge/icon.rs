use std::{
    io::{self, Cursor},
    ptr,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use tauri::{image::Image, tray::TrayIcon, Runtime};
use tray_icon::Icon;
use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIcon, HICON};

const ICON_SIZE: u32 = 32;
const MAX_AVATAR_PIXELS: u32 = 128;
const MAX_ENCODED_AVATAR: usize = 112_000;
const MASK_BYTES: usize = (ICON_SIZE as usize / u8::BITS as usize) * ICON_SIZE as usize;

pub(super) struct FlashFrames {
    avatar: Image<'static>,
    transparent: Icon,
}

impl FlashFrames {
    pub(super) fn for_avatar(data: Option<&str>) -> io::Result<Self> {
        let handle = create_transparent_icon()?;
        let avatar = avatar(data);
        let transparent = Icon::from_handle(handle as isize);
        Ok(Self {
            avatar,
            transparent,
        })
    }

    pub(super) fn apply<R: Runtime>(
        &self,
        tray: &TrayIcon<R>,
        show_avatar: bool,
    ) -> tauri::Result<()> {
        if show_avatar {
            tray.set_icon(Some(self.avatar.clone()))
        } else {
            let icon = self.transparent.clone();
            tray.with_inner_tray_icon(move |inner| inner.set_icon(Some(icon)))?
                .map_err(Into::into)
        }
    }
}

fn create_transparent_icon() -> io::Result<HICON> {
    // An all-zero RGBA frame can fall back to a Windows color mask. The monochrome
    // AND/XOR operation instead preserves every background pixel in the same tray slot.
    let and_mask = [u8::MAX; MASK_BYTES];
    let xor_mask = [0; MASK_BYTES];
    // SAFETY: The width is word-aligned at one bit per pixel and both masks are fully sized.
    let handle = unsafe {
        CreateIcon(
            ptr::null_mut(),
            ICON_SIZE as i32,
            ICON_SIZE as i32,
            1,
            1,
            and_mask.as_ptr(),
            xor_mask.as_ptr(),
        )
    };
    if handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(handle)
    }
}

pub(super) fn normal() -> Image<'static> {
    tauri::include_image!("icons/32x32.png")
}

fn avatar(data: Option<&str>) -> Image<'static> {
    let Some(mut pixels) = data.and_then(decode_avatar) else {
        return normal();
    };
    let center = (f64::from(ICON_SIZE) - 1.0) / 2.0;
    let radius = f64::from(ICON_SIZE) / 2.0;
    for (x, y, pixel) in pixels.enumerate_pixels_mut() {
        let distance = (f64::from(x) - center).hypot(f64::from(y) - center);
        let coverage = (radius + 0.5 - distance).clamp(0.0, 1.0);
        pixel[3] = (f64::from(pixel[3]) * coverage).round() as u8;
    }
    Image::new_owned(pixels.into_raw(), ICON_SIZE, ICON_SIZE)
}

fn decode_avatar(data: &str) -> Option<image::RgbaImage> {
    let encoded = data.strip_prefix("data:image/png;base64,")?;
    if encoded.len() > MAX_ENCODED_AVATAR {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_AVATAR_PIXELS);
    limits.max_image_height = Some(MAX_AVATAR_PIXELS);
    reader.limits(limits);
    Some(
        reader
            .decode()
            .ok()?
            .resize_to_fill(ICON_SIZE, ICON_SIZE, FilterType::Triangle)
            .into_rgba8(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transparent_frame_has_a_mask_and_no_color_bitmap() {
        use windows_sys::Win32::{
            Graphics::Gdi::{DeleteObject, GetBitmapBits},
            UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO},
        };
        let handle = create_transparent_icon().unwrap();
        let mut info = ICONINFO::default();
        let mut mask = [0_u8; MASK_BYTES * 2];
        // SAFETY: The icon is live, and GetIconInfo returns owned bitmaps.
        unsafe {
            assert_ne!(GetIconInfo(handle, &mut info), 0);
            assert!(info.hbmColor.is_null());
            assert_eq!(
                GetBitmapBits(info.hbmMask, mask.len() as i32, mask.as_mut_ptr().cast()),
                mask.len() as i32
            );
            assert_ne!(DeleteObject(info.hbmMask), 0);
            assert_ne!(DestroyIcon(handle), 0);
        }
        assert_eq!(&mask[..MASK_BYTES], &[u8::MAX; MASK_BYTES]);
        assert_eq!(&mask[MASK_BYTES..], &[0; MASK_BYTES]);
    }
}
