use super::{BrowserError, Dock, Result};
use crate::provider_browser::Bounds;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
use tauri::Webview;
use windows_sys::core::BOOL;
use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, SetWindowRgn};
use windows_sys::Win32::{Foundation::*, UI::WindowsAndMessaging::*};

const WINDOW_CLASS: &str = "Chrome_WidgetWin_1";
const OPEN_TIMEOUT: Duration = Duration::from_secs(8);
const PROPERTY: windows_sys::core::PCWSTR = windows_sys::w!("RemoteAI.Inspector");
static NEXT_MARKER: AtomicUsize = AtomicUsize::new(1);

pub(super) struct InspectorWindow {
    handle: usize,
    process: u32,
    marker: usize,
    style: isize,
    extended: isize,
    rectangle: RECT,
    dock: Dock,
    caption: i32,
}

pub(super) struct Discovery {
    process: u32,
    before: HashSet<usize>,
}

impl Discovery {
    pub(super) fn new(process: u32) -> Self {
        Self {
            process,
            before: candidates(process),
        }
    }
}

fn browser_process(view: &Webview) -> Result<u32> {
    let (sender, receiver) = mpsc::sync_channel(1);
    view.with_webview(move |native| {
        // SAFETY: Tauri dispatches to the WebView2 controller's owning COM apartment.
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|core| {
                let mut process = 0;
                core.BrowserProcessId(&mut process)?;
                Ok(process)
            })
        };
        if sender.send(result).is_err() {
            eprintln!("Inspector process lookup timed out");
        }
    })
    .map_err(|_| BrowserError::Unavailable)?;
    receiver
        .recv_timeout(OPEN_TIMEOUT)
        .map_err(|_| BrowserError::Unavailable)?
        .map_err(|_| BrowserError::Unavailable)
}

fn is_candidate(handle: HWND, process: u32) -> bool {
    // SAFETY: HWNDs are only queried, and invalid/stale handles fail validation.
    unsafe {
        let mut owner = 0;
        GetWindowThreadProcessId(handle, &mut owner);
        let mut class = [0u16; 128];
        let size = GetClassNameW(handle, class.as_mut_ptr(), class.len() as i32);
        owner == process
            && size > 0
            && String::from_utf16_lossy(&class[..size as usize]) == WINDOW_CLASS
    }
}

fn candidates(process: u32) -> HashSet<usize> {
    struct Enumeration {
        process: u32,
        handles: HashSet<usize>,
    }
    unsafe extern "system" fn visit(handle: HWND, parameter: LPARAM) -> BOOL {
        // SAFETY: EnumWindows invokes this callback synchronously with the stack-owned enumeration.
        let state = unsafe { &mut *(parameter as *mut Enumeration) };
        // Another tab may already have adopted a window from the same WebView2 process.
        if is_candidate(handle, state.process) && unsafe { GetPropW(handle, PROPERTY).is_null() } {
            state.handles.insert(handle as usize);
        }
        1
    }
    let mut state = Enumeration {
        process,
        handles: HashSet::new(),
    };
    // SAFETY: The callback neither retains the pointer nor stops the enumeration.
    unsafe {
        EnumWindows(Some(visit), &mut state as *mut _ as LPARAM);
    }
    state.handles
}

impl InspectorWindow {
    pub(super) fn identity(&self) -> usize {
        self.marker
    }

    pub(super) fn open(view: &Webview, discovery: Option<Discovery>) -> Result<Self> {
        let Discovery { process, before } = match discovery {
            Some(discovery) => discovery,
            None => {
                let discovery = Discovery::new(browser_process(view)?);
                view.open_devtools();
                discovery
            }
        };
        let deadline = Instant::now() + OPEN_TIMEOUT;
        loop {
            let after = candidates(process);
            let added: Vec<_> = after.difference(&before).copied().collect();
            if added.len() > 1 {
                return Err(BrowserError::Unavailable);
            }
            if let Some(handle) = added.first() {
                return Self::capture(*handle, process);
            }
            if Instant::now() >= deadline {
                return Err(BrowserError::Unavailable);
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    }

    fn capture(handle: usize, process: u32) -> Result<Self> {
        let marker = NEXT_MARKER.fetch_add(1, Ordering::Relaxed);
        let mut rectangle = RECT::default();
        // SAFETY: This is the unique newly opened HWND of the tab's WebView2 browser process.
        // The marker prevents subsequent operations on a recycled HWND, even in the same process.
        unsafe {
            let hwnd = handle as HWND;
            if !is_candidate(hwnd, process)
                || GetWindowRect(hwnd, &mut rectangle) == 0
                || SetPropW(hwnd, PROPERTY, marker as HANDLE) == 0
            {
                return Err(BrowserError::Unavailable);
            }
            Ok(Self {
                handle,
                process,
                marker,
                rectangle,
                dock: Dock::Window,
                caption: 0,
                style: GetWindowLongPtrW(hwnd, GWL_STYLE),
                extended: GetWindowLongPtrW(hwnd, GWL_EXSTYLE),
            })
        }
    }

    pub(super) fn alive(&self) -> bool {
        // SAFETY: No dereference of a foreign handle or property; both are only compared.
        unsafe {
            is_candidate(self.handle as HWND, self.process)
                && GetPropW(self.handle as HWND, PROPERTY) as usize == self.marker
        }
    }

    pub(super) fn close(&self) -> Result<()> {
        // SAFETY: The marker and process check establish that this is still our inspector.
        if self.alive() && unsafe { PostMessageW(self.handle as HWND, WM_CLOSE, 0, 0) } == 0 {
            return Err(BrowserError::Unavailable);
        }
        Ok(())
    }

    pub(super) fn place(
        &mut self,
        view: &Webview,
        dock: Dock,
        bounds: Bounds,
        visible: bool,
    ) -> Result<()> {
        if !self.alive() {
            return Err(BrowserError::Unavailable);
        }
        let parent = view
            .window()
            .hwnd()
            .map_err(|_| BrowserError::Unavailable)?
            .0;
        let scale = view
            .window()
            .scale_factor()
            .map_err(|_| BrowserError::Unavailable)?;
        // SAFETY: This method runs on a worker, with a live inspector marker and a Tauri-owned parent.
        // Reparenting and style changes are paired; floating restores the exact original styles/geometry.
        unsafe {
            let hwnd = self.handle as HWND;
            if dock != self.dock {
                self.reparent(parent, dock)?;
            }
            if dock != Dock::Window {
                let width = (bounds.width * scale).round() as i32;
                let height = (bounds.height * scale).round() as i32;
                let region = CreateRectRgn(0, self.caption, width, height + self.caption);
                if region.is_null() {
                    return Err(BrowserError::Unavailable);
                }
                if SetWindowRgn(hwnd, region, 1) == 0 {
                    DeleteObject(region); // Ownership transfers to Windows only on success.
                    return Err(BrowserError::Unavailable);
                }
                check(SetWindowPos(
                    hwnd,
                    HWND_TOP,
                    (bounds.x * scale).round() as i32,
                    (bounds.y * scale).round() as i32 - self.caption,
                    width,
                    height + self.caption,
                    SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                ))?;
            }
            ShowWindowAsync(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
        Ok(())
    }

    unsafe fn reparent(&mut self, parent: HWND, dock: Dock) -> Result<()> {
        // SAFETY: Only called by place after validating both handles. SetParent may block on the
        // browser thread, so this work must never execute on the Tauri UI thread.
        unsafe {
            let hwnd = self.handle as HWND;
            if dock == Dock::Window {
                check(SetWindowRgn(hwnd, std::ptr::null_mut(), 1))?;
                set_parent(hwnd, std::ptr::null_mut())?;
                set_style(hwnd, GWL_STYLE, self.style)?;
                set_style(hwnd, GWL_EXSTYLE, self.extended)?;
                let r = self.rectangle;
                check(SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    r.left,
                    r.top,
                    r.right - r.left,
                    r.bottom - r.top,
                    SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS,
                ))?;
            } else if self.dock == Dock::Window {
                check(GetWindowRect(hwnd, &mut self.rectangle))?;
                // Chromium may keep its custom caption after WS_CAPTION is removed. Crop the
                // measured native title bar instead of leaving active minimize/maximize buttons inside the page.
                let mut title = TITLEBARINFO {
                    cbSize: std::mem::size_of::<TITLEBARINFO>() as u32,
                    ..Default::default()
                };
                check(GetTitleBarInfo(hwnd, &mut title))?;
                self.caption = (title.rcTitleBar.bottom - self.rectangle.top).max(0);
                let style =
                    (self.style as u32 & !(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD;
                set_style(hwnd, GWL_STYLE, style as isize)?;
                set_style(
                    hwnd,
                    GWL_EXSTYLE,
                    self.extended & !(WS_EX_APPWINDOW as isize),
                )?;
                if let Err(error) = set_parent(hwnd, parent) {
                    set_style(hwnd, GWL_STYLE, self.style)?;
                    set_style(hwnd, GWL_EXSTYLE, self.extended)?;
                    return Err(error);
                }
                check(SetWindowPos(
                    hwnd,
                    HWND_TOP,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE
                        | SWP_NOMOVE
                        | SWP_NOSIZE
                        | SWP_FRAMECHANGED
                        | SWP_ASYNCWINDOWPOS,
                ))?;
            }
            self.dock = dock;
        }
        Ok(())
    }
}

fn check(success: BOOL) -> Result<()> {
    if success == 0 {
        Err(BrowserError::Unavailable)
    } else {
        Ok(())
    }
}

unsafe fn set_parent(window: HWND, parent: HWND) -> Result<()> {
    // SAFETY: The caller validated HWNDs. A null previous parent is a successful result too.
    unsafe {
        SetLastError(0);
        let previous = SetParent(window, parent);
        if previous.is_null() && GetLastError() != 0 {
            Err(BrowserError::Unavailable)
        } else {
            Ok(())
        }
    }
}

unsafe fn set_style(window: HWND, index: i32, value: isize) -> Result<()> {
    // SAFETY: The caller validated HWND and passes only GWL_STYLE or GWL_EXSTYLE.
    unsafe {
        SetLastError(0);
        let previous = SetWindowLongPtrW(window, index, value);
        if previous == 0 && GetLastError() != 0 {
            Err(BrowserError::Unavailable)
        } else {
            Ok(())
        }
    }
}

impl Drop for InspectorWindow {
    fn drop(&mut self) {
        // SAFETY: Remove only this object's marker, never a recycled window's property.
        unsafe {
            if self.alive() {
                RemovePropW(self.handle as HWND, PROPERTY);
            }
        }
    }
}
