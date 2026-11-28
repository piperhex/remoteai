use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, ImageFormat, ImageReader, Limits};
use tauri::image::Image;

const ICON_SIZE: u32 = 32;
const MAX_AVATAR_PIXELS: u32 = 128;
const MAX_ENCODED_AVATAR: usize = 112_000;
const DIMMED_ALPHA_PERCENT: u16 = 20;

pub(super) struct FlashFrames {
    bright: Image<'static>,
    dimmed: Image<'static>,
}

impl FlashFrames {
    pub(super) fn for_avatar(data: Option<&str>) -> Self {
        let bright = avatar(data);
        let dimmed = dimmed(&bright);
        Self { bright, dimmed }
    }

    pub(super) fn image(&self, bright: bool) -> Image<'static> {
        if bright {
            self.bright.clone()
        } else {
            self.dimmed.clone()
        }
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

fn dimmed(icon: &Image<'_>) -> Image<'static> {
    let mut rgba = icon.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[3] = (u16::from(pixel[3]) * DIMMED_ALPHA_PERCENT / 100) as u8;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_sender_is_clearly_dimmed_even_if_the_avatar_matches_the_app_icon() {
        let avatar = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(include_bytes!("../../../icons/32x32.png"))
        );
        let frames = FlashFrames::for_avatar(Some(&avatar));
        let bright = frames.image(true);
        let dimmed = frames.image(false);
        assert_eq!(
            (bright.width(), bright.height()),
            (dimmed.width(), dimmed.height())
        );
        assert!(bright.rgba().chunks_exact(4).any(|pixel| pixel[3] == 255));
        for (bright, dimmed) in bright
            .rgba()
            .chunks_exact(4)
            .zip(dimmed.rgba().chunks_exact(4))
        {
            assert_eq!(bright[..3], dimmed[..3]);
            assert!(u16::from(dimmed[3]) * 5 <= u16::from(bright[3]));
        }
    }
}
