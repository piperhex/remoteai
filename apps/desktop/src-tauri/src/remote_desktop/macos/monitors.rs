use super::super::{
    displays::{Bounds, DisplayInfo},
    DesktopError, Result,
};

const MAX_DISPLAYS: usize = 32;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub(super) struct Point {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Size {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    origin: Point,
    size: Size,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> Rect;
    fn CGDisplayPixelsWide(display: u32) -> usize;
    fn CGDisplayPixelsHigh(display: u32) -> usize;
    fn CGDisplayIsMain(display: u32) -> u32;
}

#[derive(Clone)]
pub(crate) struct Monitor {
    pub info: DisplayInfo,
    pub handle: u32,
    /// Quartz input uses logical points, independently of the encoded pixel dimensions.
    pub bounds: Bounds,
}

impl Monitor {
    pub fn refresh(&self) -> Result<Self> {
        list()?
            .into_iter()
            .find(|display| display.handle == self.handle)
            .ok_or(DesktopError::DisplayGone)
    }
}

pub(in crate::remote_desktop) fn list() -> Result<Vec<Monitor>> {
    let mut handles = [0; MAX_DISPLAYS];
    let mut count = 0;
    // SAFETY: Both output pointers address live writable storage of the declared capacity.
    let status =
        unsafe { CGGetActiveDisplayList(MAX_DISPLAYS as u32, handles.as_mut_ptr(), &mut count) };
    if status != 0 || count as usize > handles.len() {
        return Err(DesktopError::DisplayEnumeration);
    }
    if count == 0 {
        return Err(DesktopError::NoDisplays);
    }
    handles[..count as usize]
        .iter()
        .enumerate()
        .map(|(index, &handle)| read(handle, index))
        .collect()
}

fn read(handle: u32, index: usize) -> Result<Monitor> {
    // SAFETY: IDs are from CoreGraphics enumeration; these read-only APIs accept scalar display IDs.
    let (rect, width, height, primary) = unsafe {
        (
            CGDisplayBounds(handle),
            CGDisplayPixelsWide(handle),
            CGDisplayPixelsHigh(handle),
            CGDisplayIsMain(handle) != 0,
        )
    };
    if width == 0 || height == 0 || rect.size.width < 1.0 || rect.size.height < 1.0 {
        return Err(DesktopError::DisplayGone);
    }
    Ok(Monitor {
        info: DisplayInfo {
            id: format!("macos:{handle}"),
            name: format!("显示器 {}", index + 1),
            width: width as u32,
            height: height as u32,
            primary,
        },
        handle,
        bounds: Bounds {
            x: rect.origin.x as i32,
            y: rect.origin.y as i32,
            width: rect.size.width as u32,
            height: rect.size.height as u32,
        },
    })
}

pub(in crate::remote_desktop) fn select(monitors: &[Monitor], id: Option<&str>) -> Result<Monitor> {
    monitors
        .iter()
        .find(|monitor| Some(monitor.info.id.as_str()) == id)
        .or_else(|| monitors.iter().find(|monitor| monitor.info.primary))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or(DesktopError::Platform)
}
