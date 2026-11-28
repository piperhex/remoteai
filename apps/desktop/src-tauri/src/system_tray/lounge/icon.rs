use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use tauri::image::Image;

const ICON_SIZE: u32 = 32;
const MAX_AVATAR_PIXELS: u32 = 128;
const MAX_ENCODED_AVATAR: usize = 112_000;

pub(super) fn normal() -> Image<'static> {
    tauri::include_image!("icons/32x32.png")
}

pub(super) fn avatar(data: Option<&str>) -> Image<'static> {
    let Some(mut pixels) = data.and_then(decode_avatar) else {
        return dimmed_icon();
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

fn dimmed_icon() -> Image<'static> {
    let icon = normal();
    let mut rgba = icon.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[3] /= 2;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}
