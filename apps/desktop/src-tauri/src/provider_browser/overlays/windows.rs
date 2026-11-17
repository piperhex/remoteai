use super::Placement;
use std::{cell::RefCell, rc::Rc};
use webview2_com::{
    take_pwstr, CreateCoreWebView2ControllerCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationStartingEventHandler, NewWindowRequestedEventHandler,
    WindowCloseRequestedEventHandler,
};
use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::HWND;

mod window;

struct Host {
    ticket: String,
    owner: HWND,
    popup: Option<window::Popup>,
}

thread_local! {
    // Every COM object and HWND is confined to Tauri's UI apartment.
    static HOST: RefCell<Option<Rc<RefCell<Host>>>> = const { RefCell::new(None) };
}

pub(super) async fn prepare(view: tauri::Webview) -> Result<String, String> {
    let owner = view.window().hwnd().map_err(|_| "market.browserFailed")?.0 as isize;
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |view| {
        let result = install(view.controller(), view.environment(), HWND(owner as _));
        // The caller can disappear during navigation; the next prepare reuses the same host.
        let _ = send.send(result.map_err(|error| {
            eprintln!("Browser popup preparation failed: {error}");
            "market.browserFailed".to_string()
        }));
    })
    .map_err(|_| "market.browserFailed")?;
    receive
        .await
        .map_err(|_| "market.browserFailed".to_string())?
}

fn install(
    controller: ICoreWebView2Controller,
    environment: ICoreWebView2Environment,
    owner: HWND,
) -> windows::core::Result<String> {
    if let Some(host) = HOST.with(|state| state.borrow().clone()) {
        return Ok(host.borrow().ticket.clone());
    }
    let ticket = format!(
        "about:blank#remoteai-browser-overlay-{}",
        uuid::Uuid::new_v4()
    );
    let host = Rc::new(RefCell::new(Host {
        ticket: ticket.clone(),
        owner,
        popup: None,
    }));
    let handler_host = host.clone();
    // SAFETY: Called on the controller's COM apartment. The event owns its host and environment.
    unsafe {
        let core = controller.CoreWebView2()?;
        let mut token = 0;
        core.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if take_pwstr(uri) != handler_host.borrow().ticket {
                    return Ok(());
                }
                args.SetHandled(true)?;
                open(&environment, &handler_host, &args)
            })),
            &mut token,
        )?;
        let navigation_host = host.clone();
        core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, _| {
                // Release the previous renderer's portal and its HWND on reload/navigation.
                let popup = navigation_host.borrow_mut().popup.take();
                drop(popup);
                Ok(())
            })),
            &mut token,
        )?;
        window::watch_owner(owner)?;
    }
    HOST.with(|state| *state.borrow_mut() = Some(host));
    Ok(ticket)
}

unsafe fn open(
    environment: &ICoreWebView2Environment,
    host: &Rc<RefCell<Host>>,
    args: &ICoreWebView2NewWindowRequestedEventArgs,
) -> windows::core::Result<()> {
    // SAFETY: NewWindowRequested runs on the UI apartment. Creation is asynchronous and its
    // deferral keeps window.open pending until a controller from the SAME environment is attached.
    unsafe {
        let old = host.borrow_mut().popup.take();
        drop(old);
        let popup = window::Popup::create(host.borrow().owner)?;
        let hwnd = popup.hwnd;
        let deferred = args.GetDeferral()?;
        let failed = deferred.clone();
        let args = args.clone();
        let host = host.clone();
        let pending = Rc::new(RefCell::new(Some(popup)));
        let started = environment.CreateCoreWebView2Controller(
            hwnd,
            &CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |result, controller| {
                    let initialized = (|| {
                        result?;
                        let controller = controller.ok_or_else(windows::core::Error::from_win32)?;
                        attach_controller(&host, &args, &pending, controller)
                    })();
                    if let Err(error) = initialized {
                        eprintln!("Browser popup creation failed: {error}");
                    }
                    deferred.Complete()
                },
            )),
        );
        if let Err(error) = started {
            failed.Complete()?;
            return Err(error);
        }
    }
    Ok(())
}

unsafe fn attach_controller(
    host: &Rc<RefCell<Host>>,
    args: &ICoreWebView2NewWindowRequestedEventArgs,
    pending: &RefCell<Option<window::Popup>>,
    controller: ICoreWebView2Controller,
) -> windows::core::Result<()> {
    // SAFETY: Controller completion runs on the UI apartment; pending owns the new native window.
    unsafe {
        configure(&controller)?;
        let Some(mut popup) = pending.borrow_mut().take() else {
            return Ok(());
        };
        let close_host = Rc::downgrade(host);
        let hwnd = popup.hwnd;
        let mut token = 0;
        controller.CoreWebView2()?.add_WindowCloseRequested(
            &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                if let Some(host) = close_host.upgrade() {
                    let is_current = host
                        .borrow()
                        .popup
                        .as_ref()
                        .is_some_and(|popup| popup.hwnd == hwnd);
                    if is_current {
                        let popup = host.borrow_mut().popup.take();
                        drop(popup);
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        args.SetNewWindow(&controller.CoreWebView2()?)?;
        popup.controller = Some(controller);
        popup.align()?;
        host.borrow_mut().popup = Some(popup);
    }
    Ok(())
}

unsafe fn configure(controller: &ICoreWebView2Controller) -> windows::core::Result<()> {
    // SAFETY: The newly created controller has not navigated and belongs to this apartment.
    unsafe {
        controller
            .cast::<ICoreWebView2Controller2>()?
            .SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                A: 0,
                R: 0,
                G: 0,
                B: 0,
            })?;
        controller.SetIsVisible(false)?;
        let core = controller.CoreWebView2()?;
        core.Settings()?.SetAreDefaultContextMenusEnabled(false)?;
        core.Settings()?.SetIsStatusBarEnabled(false)?;
        let mut token = 0;
        core.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    if !take_pwstr(uri).starts_with("about:blank") {
                        args.SetCancel(true)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        core.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetHandled(true)?;
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

pub(super) async fn place(view: tauri::Webview, placement: Placement) -> Result<(), String> {
    dispatch(view, move |popup| popup.place(&placement)).await
}

pub(super) async fn focus(view: tauri::Webview) -> Result<(), String> {
    dispatch(view, |popup| popup.activate()).await
}

async fn dispatch(
    view: tauri::Webview,
    action: impl FnOnce(&window::Popup) -> windows::core::Result<()> + Send + 'static,
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |_| {
        let result = with_popup(action);
        // Navigation can dispose the awaiting renderer.
        let _ = send.send(result.map_err(|error| {
            eprintln!("Browser popup placement failed: {error}");
            "market.browserFailed".to_string()
        }));
    })
    .map_err(|_| "market.browserFailed")?;
    receive
        .await
        .map_err(|_| "market.browserFailed".to_string())?
}

fn with_popup(
    action: impl FnOnce(&window::Popup) -> windows::core::Result<()>,
) -> windows::core::Result<()> {
    let host = HOST.with(|state| state.borrow().clone());
    if let Some(host) = host {
        // Copy the controller and handles before Win32 calls can re-enter the owner's window procedure.
        let view = host.borrow().popup.as_ref().map(window::Popup::view);
        if let Some(view) = view {
            return action(&view);
        }
    }
    Ok(())
}

pub(super) fn moved() {
    if let Err(error) = with_popup(|popup| popup.align()) {
        eprintln!("Browser popup alignment failed: {error}");
    }
}

pub(super) fn destroyed() {
    let host = HOST.with(|state| state.borrow_mut().take());
    if let Some(host) = host {
        let popup = host.borrow_mut().popup.take();
        drop(popup);
    }
}

pub(super) fn focused() {
    if let Err(error) = with_popup(|popup| popup.focus()) {
        eprintln!("Browser popup focus failed: {error}");
    }
}

pub(super) fn remember_focus() {
    // This callback only reads native focus; with_popup currently cannot fail on this path.
    if let Err(error) = with_popup(|popup| {
        popup.remember_focus();
        Ok(())
    }) {
        eprintln!("Browser popup focus capture failed: {error}");
    }
}
