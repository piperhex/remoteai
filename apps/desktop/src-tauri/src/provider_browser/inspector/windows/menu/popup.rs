use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*};
use windows::core::{Error, Result, PWSTR};
use windows_sys::Win32::{Foundation::*, UI::WindowsAndMessaging::*};

pub(super) struct Menu {
    handle: HMENU,
    pub(super) inspect: Option<u32>,
}

impl Menu {
    pub(super) fn read(items: &ICoreWebView2ContextMenuItemCollection) -> Result<Self> {
        // SAFETY: The menu and copied UTF-16 labels are used only on the COM/UI thread.
        unsafe {
            let handle = CreatePopupMenu();
            if handle.is_null() {
                return Err(Error::from_win32());
            }
            let mut menu = Self {
                handle,
                inspect: None,
            };
            let mut count = 0;
            items.Count(&mut count)?;
            for index in 0..count {
                menu.append(&items.GetValueAtIndex(index)?)?;
            }
            Ok(menu)
        }
    }

    fn append(&mut self, item: &ICoreWebView2ContextMenuItem) -> Result<()> {
        // SAFETY: Called with WebView2-owned menu items on their apartment; AppendMenuW copies labels.
        unsafe {
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
            item.Kind(&mut kind)?;
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                return check(AppendMenuW(self.handle, MF_SEPARATOR, 0, std::ptr::null()));
            }
            let mut label = PWSTR::null();
            item.Label(&mut label)?;
            let mut text = take_pwstr(label);
            let mut shortcut = PWSTR::null();
            item.ShortcutKeyDescription(&mut shortcut)?;
            let shortcut = take_pwstr(shortcut);
            if !shortcut.is_empty() {
                text.push('\t');
                text.push_str(&shortcut);
            }
            let text: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
            let mut enabled = windows::core::BOOL::default();
            item.IsEnabled(&mut enabled)?;
            let mut checked = windows::core::BOOL::default();
            item.IsChecked(&mut checked)?;
            let flags = MF_STRING
                | if enabled.as_bool() { 0 } else { MF_GRAYED }
                | if checked.as_bool() { MF_CHECKED } else { 0 };
            if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU {
                let submenu = Self::read(&item.Children()?)?;
                check(AppendMenuW(
                    self.handle,
                    flags | MF_POPUP,
                    submenu.handle as usize,
                    text.as_ptr(),
                ))?;
                if submenu.inspect.is_some() {
                    self.inspect = submenu.inspect;
                }
                std::mem::forget(submenu); // The parent now owns the appended submenu.
            } else {
                let mut command = 0;
                item.CommandId(&mut command)?;
                check(AppendMenuW(
                    self.handle,
                    flags,
                    command as usize,
                    text.as_ptr(),
                ))?;
                let mut name = PWSTR::null();
                item.Name(&mut name)?;
                if take_pwstr(name) == "inspectElement" {
                    self.inspect = Some(command as u32);
                }
            }
            Ok(())
        }
    }

    pub(super) fn show(&self, owner: HWND, point: POINT) -> Result<u32> {
        // SAFETY: The live Tauri window owns the popup. Windows runs its modal message loop;
        // no Rust locks or Tauri command are held while tracking mouse, keyboard or touch input.
        unsafe {
            Ok(TrackPopupMenuEx(
                self.handle,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                point.x,
                point.y,
                owner,
                std::ptr::null(),
            ) as u32)
        }
    }
}

fn check(value: windows_sys::core::BOOL) -> Result<()> {
    if value == 0 {
        Err(Error::from_win32())
    } else {
        Ok(())
    }
}

impl Drop for Menu {
    fn drop(&mut self) {
        // SAFETY: This object uniquely owns the root menu and its attached submenus.
        if unsafe { DestroyMenu(self.handle) } == 0 {
            eprintln!("Inspector context menu cleanup failed");
        }
    }
}
