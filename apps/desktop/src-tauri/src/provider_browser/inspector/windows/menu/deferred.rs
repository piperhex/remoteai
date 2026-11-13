use std::{cell::RefCell, collections::HashMap};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::{
    core::Result,
    Win32::{
        Foundation::{POINT, RECT},
        Graphics::Gdi::ClientToScreen,
    },
};

struct Pending {
    core: ICoreWebView2,
    args: ICoreWebView2ContextMenuRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
    target: (tauri::AppHandle, String),
    point: windows_sys::Win32::Foundation::POINT,
}

// COM interfaces never leave their apartment. The worker passes only a token back to the UI thread.
thread_local! { static PENDING: RefCell<HashMap<uuid::Uuid, Pending>> = RefCell::default(); }

pub(super) fn schedule(
    core: ICoreWebView2,
    args: ICoreWebView2ContextMenuRequestedEventArgs,
    controller: &ICoreWebView2Controller,
    target: (tauri::AppHandle, String),
) -> Result<()> {
    // SAFETY: This is the WebView2 event's owning apartment. Its deferral retains the event until
    // after the callback returns; opening a modal popup inside the original callback is unsupported.
    let pending = unsafe {
        let mut point = POINT::default();
        args.Location(&mut point)?;
        let mut bounds = RECT::default();
        controller.Bounds(&mut bounds)?;
        point.x += bounds.left;
        point.y += bounds.top;
        let mut parent = windows::Win32::Foundation::HWND::default();
        controller.ParentWindow(&mut parent)?;
        if !ClientToScreen(parent, &mut point).as_bool() {
            return Err(windows::core::Error::from_win32());
        }
        let deferral = args.GetDeferral()?;
        args.SetHandled(true)?;
        Pending {
            core,
            deferral,
            args,
            target: target.clone(),
            point: windows_sys::Win32::Foundation::POINT {
                x: point.x,
                y: point.y,
            },
        }
    };
    let id = uuid::Uuid::new_v4();
    PENDING.with(|queue| queue.borrow_mut().insert(id, pending));
    // Tauri executes run_on_main_thread immediately when called on the UI thread, so enqueue from
    // a worker. The original COM callback must unwind before Windows starts the menu's message loop.
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = target.0.run_on_main_thread(move || run(id)) {
            eprintln!("Browser context menu dispatch failed during shutdown: {error}");
        }
    });
    Ok(())
}

fn run(id: uuid::Uuid) {
    let pending = PENDING.with(|queue| queue.borrow_mut().remove(&id));
    let Some(pending) = pending else {
        return;
    };
    if let Err(error) =
        super::context_menu(&pending.core, &pending.args, &pending.target, pending.point)
    {
        eprintln!("Browser context menu failed: {error}");
        // SAFETY: Restore the system menu on this same apartment if building our menu fails.
        if let Err(error) = unsafe { pending.args.SetHandled(false) } {
            eprintln!("Browser context menu fallback failed: {error}");
        }
    }
    // SAFETY: The native popup is closed; allow WebView2 to execute the selected original command.
    if let Err(error) = unsafe { pending.deferral.Complete() } {
        eprintln!("Browser context menu completion failed: {error}");
    }
}
