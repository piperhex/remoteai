use super::*;
use windows_sys::{w, Win32::Foundation::HANDLE, Win32::Graphics::Gdi::ClientToScreen};

struct Fixture {
    parent: HWND,
    inspector: HWND,
}

impl Fixture {
    fn new() -> Self {
        // SAFETY: Built-in STATIC windows belong to this test thread; no callback data is borrowed.
        unsafe {
            let parent = CreateWindowExW(
                0,
                w!("STATIC"),
                w!("inspector focus test"),
                WS_POPUP,
                -20000,
                -20000,
                400,
                400,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!parent.is_null());
            let inspector = CreateWindowExW(
                0,
                w!("STATIC"),
                w!("inspector"),
                WS_CHILD | WS_VISIBLE,
                100,
                100,
                200,
                200,
                parent,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!inspector.is_null());
            assert_ne!(
                SetPropW(inspector, super::super::native::PROPERTY, 1usize as HANDLE),
                0
            );
            Self { parent, inspector }
        }
    }

    fn activation_posted(&self) -> bool {
        let mut message = MSG::default();
        // SAFETY: Peek only this test window's activation messages on its owning thread.
        unsafe {
            PeekMessageW(
                &mut message,
                self.inspector,
                WM_ACTIVATE,
                WM_ACTIVATE,
                PM_REMOVE,
            ) != 0
        }
    }

    fn click(&self, event: u32, point: POINT) {
        let packed = ((point.y as u16 as u32) << 16) | point.x as u16 as u32;
        activate_clicked_inspector(self.parent, event as WPARAM, packed as LPARAM);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // SAFETY: Destroy both owned test windows on their owning thread, including detached children.
        unsafe {
            DestroyWindow(self.inspector);
            DestroyWindow(self.parent);
        }
    }
}

#[test]
fn clicks_and_touch_activate_only_the_marked_inspector() {
    let fixture = Fixture::new();
    for event in [
        WM_LBUTTONDOWN,
        WM_RBUTTONDOWN,
        WM_MBUTTONDOWN,
        WM_XBUTTONDOWN,
    ] {
        fixture.click(event, POINT { x: 150, y: 150 });
        assert!(fixture.activation_posted());
        assert!(
            !fixture.activation_posted(),
            "one activation per interaction"
        );
    }
    let mut screen = POINT { x: 150, y: 150 };
    // SAFETY: Convert a point for this test's live host window.
    assert_ne!(unsafe { ClientToScreen(fixture.parent, &mut screen) }, 0);
    fixture.click(WM_POINTERDOWN, screen);
    assert!(fixture.activation_posted());
    fixture.click(WM_LBUTTONDOWN, POINT { x: 50, y: 50 });
    fixture.click(WM_CREATE, POINT { x: 150, y: 150 });
    fixture.click(WM_MOUSEMOVE, POINT { x: 150, y: 150 });
    assert!(
        !fixture.activation_posted(),
        "other controls and non-click events never gain focus"
    );
    // SAFETY: Simulate ownership release while the same HWND remains live.
    unsafe { RemovePropW(fixture.inspector, super::super::native::PROPERTY) };
    fixture.click(WM_LBUTTONDOWN, POINT { x: 150, y: 150 });
    assert!(
        !fixture.activation_posted(),
        "unowned/recycled handles must be ignored"
    );
}

#[test]
fn hidden_disabled_and_detached_inspectors_are_ignored() {
    let fixture = Fixture::new();
    // SAFETY: Change only owned test windows, on their owning thread.
    unsafe { ShowWindow(fixture.inspector, SW_HIDE) };
    fixture.click(WM_LBUTTONDOWN, POINT { x: 150, y: 150 });
    assert!(!fixture.activation_posted());
    // SAFETY: The same owned child remains live throughout the test.
    unsafe {
        ShowWindow(fixture.inspector, SW_SHOWNOACTIVATE);
        windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow(fixture.inspector, 0);
    }
    fixture.click(WM_LBUTTONDOWN, POINT { x: 150, y: 150 });
    assert!(!fixture.activation_posted());
    // SAFETY: Restore the test child and detach it, matching the floating inspector transition.
    unsafe {
        windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow(fixture.inspector, 1);
        SetParent(fixture.inspector, std::ptr::null_mut());
    }
    fixture.click(WM_LBUTTONDOWN, POINT { x: 150, y: 150 });
    assert!(!fixture.activation_posted());
}
