use super::{
    displays::{Bounds, DisplayInfo},
    DesktopError, Result,
};
use std::{mem::size_of, ptr};
use windows_sys::Win32::{
    Foundation::{LPARAM, RECT},
    Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW},
    UI::{
        HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        WindowsAndMessaging::MONITORINFOF_PRIMARY,
    },
};

/// Thread-local scope keeps GDI, display bounds and input in the same physical pixel space at mixed DPI.
pub(super) struct PhysicalPixels(DPI_AWARENESS_CONTEXT);

impl PhysicalPixels {
    pub fn enter() -> Result<Self> {
        // SAFETY: Changes only this worker's DPI context; Drop restores the returned previous context.
        let previous =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        if previous.is_null() {
            return Err(DesktopError::Platform);
        }
        Ok(Self(previous))
    }
}

impl Drop for PhysicalPixels {
    fn drop(&mut self) {
        // SAFETY: The saved context came from this thread and the scope never crosses an await or thread boundary.
        if unsafe { SetThreadDpiAwarenessContext(self.0) }.is_null() {
            eprintln!("desktop DPI context restoration failed");
        }
    }
}

#[derive(Clone)]
pub(super) struct Monitor {
    pub info: DisplayInfo,
    pub handle: usize,
    pub bounds: Bounds,
}

impl Monitor {
    /// Reject removed/reused handles so controls never target a different screen after unplugging.
    pub fn refresh(&self) -> Result<Self> {
        let current = read(self.handle as HMONITOR)?;
        if current.info.id != self.info.id {
            return Err(DesktopError::DisplayGone);
        }
        Ok(current)
    }
}

pub(super) fn list() -> Result<Vec<Monitor>> {
    let mut monitors = Vec::<Monitor>::new();
    // SAFETY: EnumDisplayMonitors invokes the callback synchronously; the vector remains live and exclusive.
    let result = unsafe {
        EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(collect),
            (&mut monitors as *mut Vec<Monitor>) as LPARAM,
        )
    };
    if result == 0 {
        return Err(DesktopError::DisplayEnumeration);
    }
    if monitors.is_empty() {
        return Err(DesktopError::NoDisplays);
    }
    monitors.sort_by(|left, right| left.info.id.cmp(&right.info.id));
    Ok(monitors)
}

pub(super) fn select(monitors: &[Monitor], id: Option<&str>) -> Result<Monitor> {
    // Reopening after a screen was unplugged returns the primary screen and its actual ID to the viewer.
    monitors
        .iter()
        .find(|monitor| Some(monitor.info.id.as_str()) == id)
        .or_else(|| monitors.iter().find(|monitor| monitor.info.primary))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or(DesktopError::Platform)
}

unsafe extern "system" fn collect(handle: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> i32 {
    let Ok(monitor) = read(handle) else {
        return 0;
    };
    // SAFETY: data points to the exclusive vector supplied by list for this synchronous enumeration.
    unsafe {
        (&mut *(data as *mut Vec<Monitor>)).push(monitor);
    }
    1
}

fn read(handle: HMONITOR) -> Result<Monitor> {
    let _dpi = PhysicalPixels::enter()?;
    let mut info: MONITORINFOEXW = Default::default();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    // SAFETY: info is a live MONITORINFOEXW with its ABI size set; Windows validates the borrowed handle.
    if unsafe { GetMonitorInfoW(handle, &mut info.monitorInfo) } == 0 {
        return Err(DesktopError::DisplayGone);
    }
    let rect = info.monitorInfo.rcMonitor;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return Err(DesktopError::Platform);
    }
    let end = info
        .szDevice
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(info.szDevice.len());
    let id = String::from_utf16_lossy(&info.szDevice[..end]);
    let name = id.trim_start_matches(r"\\.\").to_owned();
    Ok(Monitor {
        info: DisplayInfo {
            id,
            name,
            width: width as u32,
            height: height as u32,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        },
        handle: handle as usize,
        bounds: Bounds {
            x: rect.left,
            y: rect.top,
            width: width as u32,
            height: height as u32,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(id: &str, primary: bool) -> Monitor {
        Monitor {
            info: DisplayInfo {
                id: id.into(),
                name: id.into(),
                width: 1920,
                height: 1080,
                primary,
            },
            handle: 1,
            bounds: Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
        }
    }

    #[test]
    fn selection_uses_device_identity_and_defaults_to_primary_after_disconnect() {
        let monitors = [monitor("second", false), monitor("primary", true)];
        assert_eq!(select(&monitors, Some("second")).unwrap().info.id, "second");
        assert_eq!(select(&monitors, None).unwrap().info.id, "primary");
        assert_eq!(
            select(&monitors, Some("unplugged")).unwrap().info.id,
            "primary"
        );
        assert!(select(&[], None).is_err());
    }
}
