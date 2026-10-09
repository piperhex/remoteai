//! Observe NSPasteboard changes so copy/cut never returns stale clipboard contents.
use super::super::clipboard::{ClipboardError, ClipboardResult};
use std::ffi::{c_char, c_void};

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

struct AutoreleasePool(*mut c_void);
impl Drop for AutoreleasePool {
    fn drop(&mut self) {
        // SAFETY: The token belongs to a pool pushed on this same blocking worker thread.
        unsafe {
            objc_autoreleasePoolPop(self.0);
        }
    }
}

pub(in crate::remote_desktop) fn change_count() -> ClipboardResult<isize> {
    // SAFETY: Fixed Objective-C selectors have the declared pointer/integer return types and no
    // extra arguments. NSPasteboard permits use from worker threads; its general board is borrowed.
    unsafe {
        let _pool = AutoreleasePool(objc_autoreleasePoolPush());
        let class = objc_getClass(c"NSPasteboard".as_ptr());
        if class.is_null() {
            return Err(ClipboardError::Access);
        }
        let pointer: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let integer: unsafe extern "C" fn(*mut c_void, *mut c_void) -> isize =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        let board = pointer(class, sel_registerName(c"generalPasteboard".as_ptr()));
        if board.is_null() {
            return Err(ClipboardError::Access);
        }
        Ok(integer(board, sel_registerName(c"changeCount".as_ptr())))
    }
}
