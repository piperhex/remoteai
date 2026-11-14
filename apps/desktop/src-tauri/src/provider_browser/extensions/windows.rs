use super::{Error, Result};
use std::{path::PathBuf, sync::mpsc, time::Duration};
use tauri::Webview;
use webview2_com::{
    take_pwstr, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
    Microsoft::Web::WebView2::Win32::*, ProfileAddBrowserExtensionCompletedHandler,
    ProfileGetBrowserExtensionsCompletedHandler,
};
use windows::core::{Interface, BOOL, HSTRING, PWSTR};

#[derive(Clone)]
pub(super) struct Installed {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}
pub(super) enum Operation {
    List,
    Add(PathBuf),
    Enable(String, bool),
    Remove(String),
}
type Reply = Vec<Installed>;
type Sender = mpsc::Sender<Result<Reply>>;

pub(super) fn execute(view: &Webview, operation: Operation) -> Result<Reply> {
    let (send, receive) = mpsc::channel();
    view.with_webview(move |view| {
        // SAFETY: all COM objects and callbacks stay on their owning UI apartment.
        // Only serialized Rust values cross to the blocking worker.
        let result = unsafe {
            (|| {
                let core = view.controller().CoreWebView2()?;
                let profile = core
                    .cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile7>()?;
                dispatch(&profile, operation, send.clone())
            })()
        };
        if let Err(error) = result {
            eprintln!("Browser extension operation failed: {error}");
            deliver(&send, Err(Error::Engine));
        }
    })
    .map_err(|_| Error::Engine)?;
    receive
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| Error::Engine)?
}

fn deliver(send: &Sender, value: Result<Reply>) {
    // A closed receiver means the worker already reported a timeout; never retry a mutation.
    if send.send(value).is_err() {
        eprintln!("Browser extension completion arrived after timeout");
    }
}

unsafe fn entry(extension: &ICoreWebView2BrowserExtension) -> windows::core::Result<Installed> {
    // SAFETY: the caller supplies a live extension on its owning COM apartment; output strings are
    // initialized by WebView2 and released exactly once by take_pwstr.
    unsafe {
        let mut id = PWSTR::null();
        extension.Id(&mut id)?;
        let id = take_pwstr(id);
        let mut name = PWSTR::null();
        extension.Name(&mut name)?;
        let name = take_pwstr(name);
        let mut enabled = BOOL::default();
        extension.IsEnabled(&mut enabled)?;
        Ok(Installed {
            id,
            name,
            enabled: enabled.as_bool(),
        })
    }
}

unsafe fn dispatch(
    profile: &ICoreWebView2Profile7,
    operation: Operation,
    send: Sender,
) -> windows::core::Result<()> {
    // SAFETY: execute invokes this on the profile's owning apartment. WebView2 retains callback
    // interfaces and invokes them on that apartment; only owned Rust values leave the callbacks.
    unsafe {
        if let Operation::Add(path) = operation {
            let path = HSTRING::from(path.as_os_str());
            return profile.AddBrowserExtension(
                &path,
                &ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
                    move |status, extension| {
                        let result = status
                            .and_then(|_| extension.ok_or_else(windows::core::Error::from_win32))
                            .and_then(|extension| entry(&extension))
                            .map(|entry| vec![entry]);
                        deliver(&send, result.map_err(|_| Error::Engine));
                        Ok(())
                    },
                )),
            );
        }
        profile.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(
            Box::new(move |status, list| {
                let result = status
                    .and_then(|_| list.ok_or_else(windows::core::Error::from_win32))
                    .and_then(|list| apply(&list, &operation, &send));
                if result.is_err() {
                    deliver(&send, Err(Error::Engine));
                }
                Ok(())
            }),
        ))
    }
}

unsafe fn apply(
    list: &ICoreWebView2BrowserExtensionList,
    operation: &Operation,
    send: &Sender,
) -> windows::core::Result<()> {
    // SAFETY: the completion callback supplies a live list on the UI apartment. Count bounds every
    // index, and returned extension interfaces are only used within this callback.
    unsafe {
        let mut count = 0;
        list.Count(&mut count)?;
        let mut entries = Vec::new();
        for index in 0..count {
            let extension = list.GetValueAtIndex(index)?;
            let item = entry(&extension)?;
            let target = match operation {
                Operation::Enable(id, _) | Operation::Remove(id) => id == &item.id,
                _ => false,
            };
            if target {
                return mutate(&extension, operation, send.clone());
            }
            entries.push(item);
        }
        deliver(
            send,
            if matches!(operation, Operation::List) {
                Ok(entries)
            } else {
                Err(Error::Missing)
            },
        );
        Ok(())
    }
}

unsafe fn mutate(
    extension: &ICoreWebView2BrowserExtension,
    operation: &Operation,
    send: Sender,
) -> windows::core::Result<()> {
    // SAFETY: apply passes a live extension on its owning apartment. Completion handlers retain only
    // a thread-safe channel sender, and WebView2 owns them until completion.
    unsafe {
        match operation {
            Operation::Enable(_, enabled) => extension.Enable(
                *enabled,
                &BrowserExtensionEnableCompletedHandler::create(Box::new(move |status| {
                    deliver(&send, status.map(|_| vec![]).map_err(|_| Error::Engine));
                    Ok(())
                })),
            ),
            Operation::Remove(_) => extension.Remove(
                &BrowserExtensionRemoveCompletedHandler::create(Box::new(move |status| {
                    deliver(&send, status.map(|_| vec![]).map_err(|_| Error::Engine));
                    Ok(())
                })),
            ),
            _ => Ok(()),
        }
    }
}
