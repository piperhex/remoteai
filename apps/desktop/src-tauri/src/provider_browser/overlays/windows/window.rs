use super::super::Placement;
use std::{cell::Cell, rc::Rc};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
};
use windows::core::{Error, Result};
use windows::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetFocus, SetActiveWindow, SetFocus},
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

const CLASS: &[u16] = &[
    82, 101, 109, 111, 116, 101, 65, 73, 66, 114, 111, 119, 115, 101, 114, 80, 111, 112, 117, 112,
    0,
];
const SUBCLASS: usize = 0x52414950;

pub(super) struct Popup {
    pub(super) hwnd: HWND,
    owner: HWND,
    pub(super) controller: Option<ICoreWebView2Controller>,
    owned: bool,
    previous_focus: Rc<Cell<windows_sys::Win32::Foundation::HWND>>,
}

impl Popup {
    pub(super) fn create(owner: HWND) -> Result<Self> {
        // SAFETY: Called on the UI thread; the class uses a static procedure and all handles stay
        // on this apartment. The popup is owned by the app, never globally topmost.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WNDCLASSW {
                lpfnWndProc: Some(popup_proc),
                hInstance: instance,
                lpszClassName: CLASS.as_ptr(),
                ..Default::default()
            };
            if RegisterClassW(&class) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
                return Err(Error::from_win32());
            }
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOREDIRECTIONBITMAP,
                CLASS.as_ptr(),
                CLASS.as_ptr(),
                WS_POPUP | WS_CLIPCHILDREN,
                0,
                0,
                1,
                1,
                owner.0,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err(Error::from_win32());
            }
            let popup = Self {
                hwnd: HWND(hwnd),
                owner,
                controller: None,
                owned: true,
                previous_focus: Rc::new(Cell::new(std::ptr::null_mut())),
            };
            popup.align()?;
            Ok(popup)
        }
    }

    pub(super) fn view(&self) -> Self {
        Self {
            hwnd: self.hwnd,
            owner: self.owner,
            controller: self.controller.clone(),
            owned: false,
            previous_focus: self.previous_focus.clone(),
        }
    }

    pub(super) fn focus(&self) -> Result<()> {
        // SAFETY: A focused native host must explicitly hand its keyboard focus to WebView2.
        unsafe {
            if let Some(controller) = &self.controller {
                controller.MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)?;
            }
        }
        Ok(())
    }

    pub(super) fn activate(&self) -> Result<()> {
        // SAFETY: Only transfer focus inside our already foreground app. Background refreshes must
        // never interrupt another application. SetActiveWindow returns the previous active HWND.
        unsafe {
            let foreground = GetForegroundWindow();
            if (foreground != self.owner.0 && foreground != self.hwnd.0)
                || IsWindowVisible(self.hwnd.0) == 0
            {
                return Ok(());
            }
            self.remember_focus();
            SetActiveWindow(self.hwnd.0);
        }
        self.focus()
    }

    pub(super) fn remember_focus(&self) {
        // SAFETY: Only retain a live child of our owner on this UI thread, never another app's focus.
        unsafe {
            let focus = GetFocus();
            if !focus.is_null() && GetAncestor(focus, GA_ROOT) == self.owner.0 {
                self.previous_focus.set(focus);
            }
        }
    }

    fn hide(&self) {
        // SAFETY: Return focus only if this popup currently owns it. Showing a suggestion without
        // activation must not disturb the page, and closing a background menu must not steal focus.
        unsafe {
            let restore = GetForegroundWindow() == self.hwnd.0;
            ShowWindow(self.hwnd.0, SW_HIDE);
            let focus = self.previous_focus.replace(std::ptr::null_mut());
            if restore {
                SetActiveWindow(self.owner.0);
                if IsWindow(focus) != 0 {
                    SetFocus(focus);
                }
            }
        }
    }

    pub(super) fn align(&self) -> Result<()> {
        // SAFETY: Both windows belong to this thread. No borrow or lock is held across messages.
        unsafe {
            let mut rect = std::mem::zeroed();
            check(GetClientRect(self.owner.0, &mut rect))?;
            let mut origin = POINT { x: 0, y: 0 };
            check(ClientToScreen(self.owner.0, &mut origin))?;
            check(SetWindowPos(
                self.hwnd.0,
                std::ptr::null_mut(),
                origin.x,
                origin.y,
                rect.right,
                rect.bottom,
                SWP_NOACTIVATE | SWP_NOZORDER,
            ))?;
            if let Some(controller) = &self.controller {
                controller.SetBounds(RECT {
                    left: 0,
                    top: 0,
                    right: rect.right,
                    bottom: rect.bottom,
                })?;
                controller.NotifyParentWindowPositionChanged()?;
            }
            Ok(())
        }
    }

    pub(super) fn place(&self, placement: &Placement) -> Result<()> {
        self.align()?;
        // SAFETY: Validated CSS rectangles are scaled to this popup's client coordinates. A successful
        // SetWindowRgn transfers region ownership to Windows; failures release it here.
        unsafe {
            if placement.regions.is_empty() {
                self.hide();
                return Ok(());
            }
            let region = CreateRectRgn(0, 0, 0, 0);
            if region.is_null() {
                return Err(Error::from_win32());
            }
            for rect in &placement.regions {
                let part = CreateRectRgn(
                    (rect.x * placement.scale).floor() as i32,
                    (rect.y * placement.scale).floor() as i32,
                    ((rect.x + rect.width) * placement.scale).ceil() as i32,
                    ((rect.y + rect.height) * placement.scale).ceil() as i32,
                );
                if part.is_null() {
                    DeleteObject(region);
                    return Err(Error::from_win32());
                }
                let combined = CombineRgn(region, region, part, RGN_OR);
                DeleteObject(part);
                if combined == 0 {
                    DeleteObject(region);
                    return Err(Error::from_win32());
                }
            }
            if SetWindowRgn(self.hwnd.0, region, 1) == 0 {
                DeleteObject(region);
                return Err(Error::from_win32());
            }
            if let Some(controller) = &self.controller {
                controller.SetIsVisible(true)?;
            }
            ShowWindow(self.hwnd.0, SW_SHOWNOACTIVATE);
            Ok(())
        }
    }
}

impl Drop for Popup {
    fn drop(&mut self) {
        if !self.owned {
            return;
        }
        // SAFETY: Owning instances are dropped on the UI apartment, before destroying their HWND.
        unsafe {
            if let Some(controller) = &self.controller {
                if let Err(error) = controller.Close() {
                    eprintln!("Browser popup close failed: {error}");
                }
            }
            if IsWindow(self.hwnd.0) != 0 && DestroyWindow(self.hwnd.0) == 0 {
                eprintln!(
                    "Browser popup window cleanup failed: {}",
                    Error::from_win32()
                );
            }
        }
    }
}

pub(super) unsafe fn watch_owner(owner: HWND) -> Result<()> {
    // SAFETY: Subclass is installed and removed on the window's owning thread.
    unsafe { check(SetWindowSubclass(owner.0, Some(owner_proc), SUBCLASS, 0)) }
}

unsafe extern "system" fn popup_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // SAFETY: Windows supplies the live HWND and message parameters; unhandled messages use DefWindowProc.
    unsafe {
        // Showing suggestions never activates the popup; an explicit click allows keyboard input.
        if message == WM_SETFOCUS {
            super::focused();
        }
        if message == WM_MOUSEACTIVATE {
            super::remember_focus();
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }
}

unsafe extern "system" fn owner_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    // SAFETY: This subclass is attached only to the owner. Alignment copies handles before reentry.
    unsafe {
        if message == WM_WINDOWPOSCHANGED {
            super::moved();
        }
        if message == WM_NCDESTROY {
            RemoveWindowSubclass(hwnd, Some(owner_proc), SUBCLASS);
            super::destroyed();
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }
}

fn check(result: windows_sys::core::BOOL) -> Result<()> {
    if result == 0 {
        Err(Error::from_win32())
    } else {
        Ok(())
    }
}
