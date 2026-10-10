//! Read installed application artwork on the file-action worker, never on the UI thread.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    mem::size_of,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    ptr,
};
use windows::{
    core::HSTRING,
    Management::Deployment::PackageManager,
    Win32::{
        Foundation::RPC_E_CHANGED_MODE,
        System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    },
};
use windows_sys::Win32::{
    Graphics::Gdi::*,
    UI::{
        Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
        WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON},
    },
};

const ICON_SIZE: i32 = 32;
const PIXEL_BYTES: usize = (ICON_SIZE * ICON_SIZE * 4) as usize;

struct Apartment(bool);
impl Apartment {
    fn enter() -> Option<Self> {
        // SAFETY: Initialize WinRT/COM for this worker; an existing apartment remains usable.
        match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
            Ok(()) => Some(Self(true)),
            Err(error) if error.code() == RPC_E_CHANGED_MODE => Some(Self(false)),
            Err(_) => None,
        }
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: Balance only this thread's successful RoInitialize call.
            unsafe { RoUninitialize() };
        }
    }
}

struct Icon(HICON);
impl Icon {
    fn load(path: &Path) -> Option<Self> {
        // Unlike filesystem APIs, the Shell does not accept forward slashes in executable paths.
        let mut wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .map(|unit| {
                if unit == u16::from(b'/') {
                    u16::from(b'\\')
                } else {
                    unit
                }
            })
            .collect();
        if !path.is_absolute() || wide.contains(&0) {
            return None;
        }
        wide.push(0);
        let mut info = SHFILEINFOW::default();
        // SAFETY: The path is terminated and info is writable; SHGFI_ICON transfers icon ownership.
        let result = unsafe {
            SHGetFileInfoW(
                wide.as_ptr(),
                0,
                &mut info,
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        if result == 0 || info.hIcon.is_null() {
            return None;
        }
        Some(Self(info.hIcon))
    }
}
impl Drop for Icon {
    fn drop(&mut self) {
        // SAFETY: This icon was allocated by SHGetFileInfoW and is no longer in use.
        unsafe { DestroyIcon(self.0) };
    }
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    pixels: *mut u8,
}
impl Surface {
    fn new() -> Option<Self> {
        let mut surface = Self {
            dc: ptr::null_mut(),
            bitmap: ptr::null_mut(),
            previous: ptr::null_mut(),
            pixels: ptr::null_mut(),
        };
        let info = bitmap_info();
        // SAFETY: The fixed-size DIB owns PIXEL_BYTES bytes; Drop releases every acquired handle.
        unsafe {
            surface.dc = CreateCompatibleDC(ptr::null_mut());
            if surface.dc.is_null() {
                return None;
            }
            let mut pixels = ptr::null_mut();
            surface.bitmap = CreateDIBSection(
                surface.dc,
                &info,
                DIB_RGB_COLORS,
                &mut pixels,
                ptr::null_mut(),
                0,
            );
            if surface.bitmap.is_null() || pixels.is_null() {
                return None;
            }
            surface.pixels = pixels.cast();
            let previous = SelectObject(surface.dc, surface.bitmap);
            if previous.is_null() || previous as isize == -1 {
                return None;
            }
            surface.previous = previous;
        }
        Some(surface)
    }

    fn render(&mut self, icon: &Icon, background: u8) -> Option<Vec<u8>> {
        // SAFETY: The selected DIB is live and has PIXEL_BYTES bytes; flush GDI before reading it.
        unsafe {
            std::slice::from_raw_parts_mut(self.pixels, PIXEL_BYTES).fill(background);
            if DrawIconEx(
                self.dc,
                0,
                0,
                icon.0,
                ICON_SIZE,
                ICON_SIZE,
                0,
                ptr::null_mut(),
                DI_NORMAL,
            ) == 0
            {
                return None;
            }
            GdiFlush();
            Some(std::slice::from_raw_parts(self.pixels, PIXEL_BYTES).to_vec())
        }
    }
}

fn bitmap_info() -> BITMAPINFO {
    BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_SIZE,
            biHeight: -ICON_SIZE,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..Default::default()
        },
        ..Default::default()
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        // SAFETY: Restore the original selection before freeing our bitmap and memory DC.
        unsafe {
            if !self.previous.is_null() {
                SelectObject(self.dc, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.dc.is_null() {
                DeleteDC(self.dc);
            }
        }
    }
}

fn transparent_rgba(black: &[u8], white: &[u8]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(black.len());
    for (dark, light) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        // Two backgrounds recover alpha for both modern RGBA icons and legacy mask icons.
        let transparency = (0..3)
            .map(|i| light[i].saturating_sub(dark[i]))
            .max()
            .unwrap_or(0);
        let alpha = 255 - transparency;
        for channel in [dark[2], dark[1], dark[0]] {
            rgba.push(if alpha == 0 {
                0
            } else {
                (u16::from(channel) * 255 / u16::from(alpha)).min(255) as u8
            });
        }
        rgba.push(alpha);
    }
    rgba
}

/// Return small, self-contained artwork; unavailable icons fall back to the menu's standard glyph.
pub(super) fn read(path: &Path) -> Option<String> {
    let _apartment = Apartment::enter()?;
    let terminal = terminal_icon_source(path);
    let icon = Icon::load(terminal.as_deref().unwrap_or(path))?;
    let mut surface = Surface::new()?;
    let rgba = transparent_rgba(&surface.render(&icon, 0)?, &surface.render(&icon, 255)?);
    let mut png = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut png),
        &rgba,
        ICON_SIZE as u32,
        ICON_SIZE as u32,
        image::ExtendedColorType::Rgba8,
    )
    .ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

fn terminal_icon_source(path: &Path) -> Option<PathBuf> {
    if !path.file_name()?.eq_ignore_ascii_case("wt.exe") {
        return None;
    }
    // The App Execution Alias has a generic icon; use the installed Terminal application's artwork.
    const FAMILIES: [&str; 3] = [
        "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
        "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
        "Microsoft.WindowsTerminalCanary_8wekyb3d8bbwe",
    ];
    let manager = PackageManager::new().ok()?;
    FAMILIES.into_iter().find_map(|family| {
        let packages = manager
            .FindPackagesByUserSecurityIdPackageFamilyName(&HSTRING::new(), &HSTRING::from(family))
            .ok()?;
        packages.into_iter().find_map(|package| {
            let location = package.InstalledLocation().ok()?.Path().ok()?;
            let executable = PathBuf::from(location.to_string()).join("WindowsTerminal.exe");
            executable.is_file().then_some(executable)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_transparent_opaque_and_partial_alpha_pixels() {
        let black = [0, 0, 0, 0, 30, 20, 10, 0, 0, 0, 128, 0];
        let white = [255, 255, 255, 0, 30, 20, 10, 0, 127, 127, 255, 0];
        assert_eq!(
            transparent_rgba(&black, &white),
            [0, 0, 0, 0, 10, 20, 30, 255, 255, 0, 0, 128]
        );
    }

    #[test]
    fn shell_icon_is_a_visible_png() {
        let path = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("explorer.exe");
        assert_visible_icon(&path);
        assert_visible_icon(Path::new(&path.to_string_lossy().replace('\\', "/")));
    }

    fn assert_visible_icon(path: &Path) {
        let icon = read(path).expect("Explorer icon");
        let bytes = STANDARD
            .decode(icon.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let pixels = image::load_from_memory(&bytes).unwrap().into_rgba8();
        assert_eq!(pixels.dimensions(), (ICON_SIZE as u32, ICON_SIZE as u32));
        assert!(pixels.pixels().any(|pixel| pixel.0[3] > 0));
    }

    #[test]
    #[ignore = "exports local application artwork for UI smoke testing; set FILE_MENU_ICON_OUTPUT"]
    fn exports_installed_application_icons() {
        let output = std::env::var_os("FILE_MENU_ICON_OUTPUT").expect("set FILE_MENU_ICON_OUTPUT");
        let applications = super::super::apps::available();
        std::fs::write(output, serde_json::to_vec(&applications).unwrap()).unwrap();
    }
}
