//! Windows display modes are enumerated only when opening or changing a display, never per frame.
use super::{displays::Resolution, DesktopError, Result};
use std::{mem::size_of, ptr};
use windows_sys::Win32::Graphics::Gdi::{
    ChangeDisplaySettingsExW, EnumDisplaySettingsW, CDS_TEST, DEVMODEW, DISP_CHANGE_SUCCESSFUL,
    DM_BITSPERPEL, DM_DISPLAYFREQUENCY, DM_PELSHEIGHT, DM_PELSWIDTH, ENUM_CURRENT_SETTINGS,
};

const MIN_DIMENSION: u32 = 320;
const MAX_DIMENSION: u32 = 8192;
const MAX_MODES: u32 = 4096;

fn dimensions(mode: &DEVMODEW) -> Resolution {
    Resolution {
        width: mode.dmPelsWidth,
        height: mode.dmPelsHeight,
    }
}

fn supported(size: Resolution) -> bool {
    (MIN_DIMENSION..=MAX_DIMENSION).contains(&size.width)
        && (MIN_DIMENSION..=MAX_DIMENSION).contains(&size.height)
}

fn read(device: &[u16], index: u32) -> Option<DEVMODEW> {
    let mut mode = DEVMODEW {
        dmSize: size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    // SAFETY: device is a terminated name from host enumeration; mode has its ABI size set.
    (unsafe { EnumDisplaySettingsW(device.as_ptr(), index, &mut mode) } != 0).then_some(mode)
}

fn modes(device: &[u16]) -> Vec<DEVMODEW> {
    (0..MAX_MODES)
        .map_while(|index| read(device, index))
        .filter(|mode| mode.dmBitsPerPel == 32 && supported(dimensions(mode)))
        .collect()
}

pub(super) fn list(id: &str) -> Vec<Resolution> {
    let device: Vec<_> = id.encode_utf16().chain(Some(0)).collect();
    let mut sizes: Vec<_> = modes(&device).iter().map(dimensions).collect();
    sizes.sort_by_key(|size| (size.width * size.height, size.width));
    sizes.dedup();
    sizes
}

fn change(device: &[u16], mode: &DEVMODEW, flags: u32) -> bool {
    // SAFETY: all pointers refer to live, initialized host-enumerated values. No registry settings are persisted.
    (unsafe {
        ChangeDisplaySettingsExW(device.as_ptr(), mode, ptr::null_mut(), flags, ptr::null())
    }) == DISP_CHANGE_SUCCESSFUL
}

pub(super) fn apply(id: &str, size: Resolution) -> Result<()> {
    if !supported(size) {
        return Err(DesktopError::Invalid);
    }
    let device: Vec<_> = id.encode_utf16().chain(Some(0)).collect();
    let original = read(&device, ENUM_CURRENT_SETTINGS).ok_or(DesktopError::DisplayGone)?;
    let mut selected = modes(&device)
        .into_iter()
        .filter(|mode| dimensions(mode) == size)
        .min_by_key(|mode| {
            mode.dmDisplayFrequency
                .abs_diff(original.dmDisplayFrequency)
        })
        .ok_or(DesktopError::Resolution)?;
    selected.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL;
    if !change(&device, &selected, CDS_TEST) {
        return Err(DesktopError::Resolution);
    }
    if change(&device, &selected, 0)
        && read(&device, ENUM_CURRENT_SETTINGS).is_some_and(|mode| dimensions(&mode) == size)
    {
        return Ok(());
    }
    if !change(&device, &original, 0) {
        eprintln!("desktop resolution rollback failed");
    }
    Err(DesktopError::Resolution)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_dimensions_before_accessing_the_desktop() {
        for size in [
            Resolution {
                width: 0,
                height: 1080,
            },
            Resolution {
                width: 1920,
                height: 8193,
            },
        ] {
            assert!(matches!(
                apply("untrusted", size),
                Err(DesktopError::Invalid)
            ));
        }
    }
}
