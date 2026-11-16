//! A reparented Chromium top-level window does not activate when its host is already active.
//! Forward only explicit clicks in a live docked inspector, without blocking either UI thread.
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    UI::{
        Input::KeyboardAndMouse::GetFocus,
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

const SUBCLASS_ID: usize = 0x43535703;
const LOW_WORD_MASK: usize = 0xffff;

#[cfg(test)]
mod tests;

pub(super) fn install(controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    // SAFETY: Installation runs on the controller/host's owning UI thread. The subclass is
    // stateless and is removed with the host; repeated browser tabs reuse the same subclass ID.
    unsafe {
        let mut parent = windows::Win32::Foundation::HWND::default();
        controller.ParentWindow(&mut parent)?;
        let root = GetAncestor(parent.0, GA_ROOT);
        if root.is_null() || SetWindowSubclass(root, Some(subclass), SUBCLASS_ID, 0) == 0 {
            return Err(windows::core::Error::from_win32());
        }
    }
    Ok(())
}

unsafe extern "system" fn subclass(
    parent: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    // SAFETY: Windows calls this on the host UI thread. No state locks or foreign synchronous
    // messages are used here, including while Chromium synchronously notifies its new parent.
    unsafe {
        if message == WM_PARENTNOTIFY && GetForegroundWindow() == parent {
            activate_clicked_inspector(parent, wparam, lparam);
        } else if message == WM_NCDESTROY {
            RemoveWindowSubclass(parent, Some(subclass), SUBCLASS_ID);
        }
        DefSubclassProc(parent, message, wparam, lparam)
    }
}

fn activate_clicked_inspector(parent: HWND, wparam: WPARAM, lparam: LPARAM) {
    let event = (wparam & LOW_WORD_MASK) as u32;
    if !matches!(
        event,
        WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN | WM_POINTERDOWN
    ) {
        return;
    }
    let mut point = POINT {
        x: lparam as i16 as i32,
        y: (lparam >> 16) as i16 as i32,
    };
    // SAFETY: Mouse parent notifications carry host-client coordinates; pointer notifications
    // carry screen coordinates. Hit-testing checks current parentage and the ownership marker,
    // so floating, hidden, closed and recycled inspector windows cannot receive activation.
    unsafe {
        if event == WM_POINTERDOWN && ScreenToClient(parent, &mut point) == 0 {
            return;
        }
        let target = ChildWindowFromPointEx(parent, point, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED);
        if target.is_null()
            || GetParent(target) != parent
            || GetPropW(target, super::native::PROPERTY).is_null()
        {
            return;
        }
        request_activation(target);
    }
}

fn request_activation(target: HWND) {
    // SAFETY: The caller checked the inspector's live ownership marker and host relationship.
    unsafe {
        let focused = GetFocus();
        if focused == target || IsChild(target, focused) != 0 {
            return;
        }
        // DefWindowProc handles WM_ACTIVATE by setting focus on the inspector's own thread.
        // Posting avoids SetFocus/SendMessage reentrancy across the two processes' UI threads.
        if PostMessageW(
            target,
            WM_ACTIVATE,
            WA_CLICKACTIVE as usize,
            focused as LPARAM,
        ) == 0
        {
            eprintln!("Browser inspector activation failed");
        }
    }
}
