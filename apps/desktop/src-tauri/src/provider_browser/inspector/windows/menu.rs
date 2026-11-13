//! Return the original native command ID to preserve Inspect's exact node, including iframe content.
mod deferred;
mod popup;
use tauri::Manager;
use webview2_com::{
    AcceleratorKeyPressedEventHandler, ContextMenuRequestedEventHandler,
    Microsoft::Web::WebView2::Win32::*,
};
use windows::core::Interface;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_F12, VK_SHIFT};

pub(super) fn install(
    core: &ICoreWebView2,
    controller: &ICoreWebView2Controller,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    let target = (app.clone(), label.clone());
    let menu_controller = controller.clone();
    // SAFETY: Registration and both event callbacks run on the owning COM apartment.
    unsafe {
        let mut token = 0;
        core.cast::<ICoreWebView2_11>()?.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |core, args| {
                if let (Some(core), Some(args)) = (core, args) {
                    if let Err(error) =
                        deferred::schedule(core, args, &menu_controller, target.clone())
                    {
                        eprintln!("Browser context menu failed: {error}");
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    install_shortcuts(controller, app, label)
}

fn context_menu(
    core: &ICoreWebView2,
    args: &ICoreWebView2ContextMenuRequestedEventArgs,
    target: &(tauri::AppHandle, String),
    point: windows_sys::Win32::Foundation::POINT,
) -> windows::core::Result<()> {
    let Some(view) = target.0.get_webview(&target.1) else {
        return Ok(());
    };
    let owner = view
        .window()
        .hwnd()
        .map_err(|_| windows::core::Error::from_win32())?;
    // SAFETY: Dispatch the selected original command after closing the native popup. Windows
    // supplies keyboard navigation and touch-invoked menu interaction; no Rust locks are held.
    unsafe {
        let menu = popup::Menu::read(&args.MenuItems()?)?;
        let selection = menu.show(owner.0, point)?;
        args.SetHandled(true)?;
        if selection == 0 {
            return Ok(());
        }
        if Some(selection) == menu.inspect {
            let mut process = 0;
            core.BrowserProcessId(&mut process)?;
            let discovery = super::native::Discovery::new(process);
            args.SetSelectedCommandId(selection as i32)?;
            super::launch(target.0.clone(), target.1.clone(), Some(discovery));
        } else {
            args.SetSelectedCommandId(selection as i32)?;
        }
    }
    Ok(())
}

fn install_shortcuts(
    controller: &ICoreWebView2Controller,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    // SAFETY: WebView2 calls this handler on the controller's COM apartment.
    unsafe {
        let mut token = 0;
        controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut key = 0;
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP;
                args.VirtualKey(&mut key)?;
                args.KeyEventKind(&mut kind)?;
                let shortcut = key == VK_F12 as u32
                    || (key == b'I' as u32
                        && GetKeyState(VK_CONTROL as i32) < 0
                        && GetKeyState(VK_SHIFT as i32) < 0);
                if shortcut && kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                    args.SetHandled(true)?;
                    super::launch(app.clone(), label.clone(), None);
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}
