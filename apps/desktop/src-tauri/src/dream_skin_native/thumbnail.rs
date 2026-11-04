use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{ImageError, ImageFormat};

const MAX_EDGE: u32 = 640;
const JPEG_QUALITY: u8 = 80;

/// Cards need a bounded raster, not the full wallpaper and its decoded pixel allocation.
pub(super) fn encode(bytes: &[u8]) -> Result<String, ImageError> {
    let thumbnail = {
        let original = image::load_from_memory(bytes)?;
        if original.width() > MAX_EDGE || original.height() > MAX_EDGE {
            original.thumbnail(MAX_EDGE, MAX_EDGE)
        } else {
            original
        }
    };
    let mut output = Cursor::new(Vec::new());
    // Preserve transparency when needed, but avoid large PNG payloads for opaque wallpapers.
    let mime = if thumbnail.color().has_alpha() {
        thumbnail.write_to(&mut output, ImageFormat::Png)?;
        "image/png"
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, JPEG_QUALITY)
            .encode_image(&thumbnail)?;
        "image/jpeg"
    };
    Ok(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(output.into_inner())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

    fn preview(image: DynamicImage) -> DynamicImage {
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let url = encode(bytes.get_ref()).unwrap();
        let (_, encoded) = url.split_once(',').unwrap();
        image::load_from_memory(&STANDARD.decode(encoded).unwrap()).unwrap()
    }

    #[test]
    fn wallpaper_decode_is_bounded_to_card_dimensions() {
        let thumbnail = preview(DynamicImage::new_rgb8(3840, 2160));
        assert_eq!(thumbnail.dimensions(), (640, 360));
        let portrait = preview(DynamicImage::new_rgb8(1080, 1920));
        assert_eq!(portrait.dimensions(), (360, 640));
    }

    #[test]
    fn small_images_keep_dimensions_and_transparency() {
        let source = RgbaImage::from_pixel(32, 16, Rgba([30, 60, 90, 128]));
        let thumbnail = preview(DynamicImage::ImageRgba8(source));
        assert_eq!(thumbnail.dimensions(), (32, 16));
        assert_eq!(thumbnail.get_pixel(0, 0), Rgba([30, 60, 90, 128]));
    }

    #[test]
    fn corrupt_images_do_not_fall_back_to_original_data() {
        assert!(encode(b"not an image").is_err());
    }
}
