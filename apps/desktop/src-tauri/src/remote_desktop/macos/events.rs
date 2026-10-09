//! Small owning wrappers keep Quartz event pointers on the blocking input worker.
use super::super::{DesktopError, Result};
use super::monitors::Point;
use std::{ffi::c_void, ptr};

type EventRef = *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> EventRef;
    fn CGEventCreateMouseEvent(
        source: *const c_void,
        kind: u32,
        point: Point,
        button: u32,
    ) -> EventRef;
    fn CGEventCreateKeyboardEvent(source: *const c_void, code: u16, down: bool) -> EventRef;
    fn CGEventCreateScrollWheelEvent(
        source: *const c_void,
        units: u32,
        count: u32,
        vertical: i32,
        ...
    ) -> EventRef;
    fn CGEventGetLocation(event: EventRef) -> Point;
    fn CGEventSetFlags(event: EventRef, flags: u64);
    fn CGEventSetIntegerValueField(event: EventRef, field: u32, value: i64);
    fn CGEventKeyboardSetUnicodeString(event: EventRef, length: usize, text: *const u16);
    fn CGEventPost(tap: u32, event: EventRef);
}

struct Event(EventRef);
impl Event {
    fn new(pointer: EventRef) -> Result<Self> {
        if pointer.is_null() {
            return Err(DesktopError::Platform);
        }
        Ok(Self(pointer))
    }
    fn post(&self, flags: u64) {
        // SAFETY: The event is owned and live until Drop; HID posting retains/copies it before returning.
        unsafe {
            CGEventSetFlags(self.0, flags);
            CGEventPost(0, self.0);
        }
    }
}
impl Drop for Event {
    fn drop(&mut self) {
        // SAFETY: Every Event owns exactly one non-null Create-rule reference.
        unsafe {
            core_foundation::base::CFRelease(self.0.cast());
        }
    }
}

pub(super) fn location() -> Result<Point> {
    // SAFETY: A null source uses the current session; the returned event is checked and owned.
    let event = Event::new(unsafe { CGEventCreate(ptr::null()) })?;
    // SAFETY: event is a live Quartz event.
    Ok(unsafe { CGEventGetLocation(event.0) })
}

pub(super) fn mouse(kind: u32, point: Point, button: u32, state: (u64, i64)) -> Result<()> {
    // SAFETY: kind/button are internal Quartz constants; point comes from the selected display.
    let event = Event::new(unsafe { CGEventCreateMouseEvent(ptr::null(), kind, point, button) })?;
    // SAFETY: Field 1 is kCGMouseEventClickState; the owned event remains live.
    unsafe {
        CGEventSetIntegerValueField(event.0, 1, state.1);
    }
    event.post(state.0);
    Ok(())
}

pub(super) fn key(code: u16, down: bool, flags: u64) -> Result<()> {
    // SAFETY: code is an allowlisted hardware keycode and the null source is supported by Quartz.
    let event = Event::new(unsafe { CGEventCreateKeyboardEvent(ptr::null(), code, down) })?;
    event.post(flags);
    Ok(())
}

pub(super) fn text(text: &str) -> Result<()> {
    // Keep surrogate pairs together; Quartz Unicode events have a small per-event string limit.
    for character in text.chars() {
        let mut buffer = [0; 2];
        let units = character.encode_utf16(&mut buffer);
        for down in [true, false] {
            // SAFETY: Virtual key 0 is valid, and units is a live UTF-16 slice copied synchronously.
            let event = Event::new(unsafe { CGEventCreateKeyboardEvent(ptr::null(), 0, down) })?;
            // SAFETY: units remains valid until Quartz finishes copying this scalar's UTF-16 representation.
            unsafe {
                CGEventKeyboardSetUnicodeString(event.0, units.len(), units.as_ptr());
            }
            event.post(0);
        }
    }
    Ok(())
}

pub(super) fn wheel(delta: i32, horizontal: bool, flags: u64) -> Result<()> {
    let (vertical, horizontal) = if horizontal { (0, -delta) } else { (delta, 0) };
    // SAFETY: wheel1 is a fixed i32 argument (required by the arm64 ABI); only wheel2 is variadic.
    // Pixel units (0) and two axes match the validated vertical and horizontal deltas.
    let event = Event::new(unsafe {
        CGEventCreateScrollWheelEvent(ptr::null(), 0, 2, vertical, horizontal)
    })?;
    event.post(flags);
    Ok(())
}
