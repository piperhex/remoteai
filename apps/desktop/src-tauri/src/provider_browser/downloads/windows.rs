use super::{files, Action, Error, Result, Snapshot, Status};
use std::{cell::RefCell, collections::HashMap, path::PathBuf};
use tauri::{AppHandle, Emitter};
use webview2_com::{
    take_pwstr, BytesReceivedChangedEventHandler, DownloadStartingEventHandler,
    Microsoft::Web::WebView2::Win32::*, StateChangedEventHandler,
};
use windows::core::{Interface, HSTRING, PWSTR};

struct Transfer {
    operation: ICoreWebView2DownloadOperation,
    pending: Option<(
        ICoreWebView2DownloadStartingEventArgs,
        ICoreWebView2Deferral,
    )>,
    snapshot: Snapshot,
    path: PathBuf,
}

// COM interfaces never leave their owning UI apartment. Commands dispatch onto that apartment.
thread_local! { static TRANSFERS: RefCell<HashMap<String, Transfer>> = RefCell::default(); }

pub(in crate::provider_browser) fn install(
    core: &ICoreWebView2,
    app: AppHandle,
) -> windows::core::Result<()> {
    // SAFETY: Installation and retained event callbacks run on the live WebView2 COM apartment.
    unsafe {
        let core: ICoreWebView2_4 = core.cast()?;
        core.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                if let Err(error) = start(&app, &args) {
                    args.SetCancel(true)?;
                    eprintln!("Browser download setup failed: {error}");
                    return Err(error);
                }
                Ok(())
            })),
            &mut 0,
        )?;
    }
    Ok(())
}

fn start(
    app: &AppHandle,
    args: &ICoreWebView2DownloadStartingEventArgs,
) -> windows::core::Result<()> {
    // SAFETY: Invoked only by DownloadStarting on its owning COM apartment; COM strings are consumed once.
    unsafe {
        let operation = args.DownloadOperation()?;
        let mut uri = PWSTR::null();
        operation.Uri(&mut uri)?;
        let uri = take_pwstr(uri);
        let mut suggested = PWSTR::null();
        args.ResultFilePath(&mut suggested)?;
        let id = uuid::Uuid::new_v4().to_string();
        let path = files::target(app, &id, &take_pwstr(suggested))
            .map_err(|_| windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL))?;
        args.SetResultFilePath(&HSTRING::from(path.to_string_lossy().as_ref()))?;
        args.SetHandled(true)?;
        let pending = if super::insecure(&uri) {
            Some((args.clone(), args.GetDeferral()?))
        } else {
            None
        };
        let snapshot = Snapshot::new(id.clone(), &path, &uri, pending.is_some());
        observe(&operation, app, &id)?;
        TRANSFERS.with_borrow_mut(|items| {
            items.insert(
                id.clone(),
                Transfer {
                    operation,
                    pending,
                    snapshot,
                    path,
                },
            )
        });
        publish(app, &id)
    }
}

fn observe(
    operation: &ICoreWebView2DownloadOperation,
    app: &AppHandle,
    id: &str,
) -> windows::core::Result<()> {
    let progress_app = app.clone();
    let progress_id = id.to_string();
    let state_app = app.clone();
    let state_id = id.to_string();
    // SAFETY: The operation retains both handlers on the COM apartment. No interface crosses threads.
    unsafe {
        operation.add_BytesReceivedChanged(
            &BytesReceivedChangedEventHandler::create(Box::new(move |_, _| {
                publish(&progress_app, &progress_id)
            })),
            &mut 0,
        )?;
        operation.add_StateChanged(
            &StateChangedEventHandler::create(Box::new(move |_, _| publish(&state_app, &state_id))),
            &mut 0,
        )?;
    }
    Ok(())
}

fn publish(app: &AppHandle, id: &str) -> windows::core::Result<()> {
    let value = TRANSFERS.with_borrow_mut(|items| -> windows::core::Result<Option<Snapshot>> {
        let Some(item) = items.get_mut(id) else {
            return Ok(None);
        };
        let previous = item.snapshot.status;
        item.snapshot.sequence += 1;
        refresh(item)?;
        if previous != Status::Completed && item.snapshot.status == Status::Completed {
            files::completed(app.clone(), id.to_string(), item.path.clone());
        }
        Ok(Some(item.snapshot.clone()))
    })?;
    if let Some(snapshot) = value {
        if let Err(error) = app.emit_to("main", "browser-download", snapshot) {
            eprintln!("Browser download notification failed: {error}");
        }
    }
    Ok(())
}

fn refresh(item: &mut Transfer) -> windows::core::Result<()> {
    // SAFETY: The transfer and its operation are accessed only on the COM apartment.
    unsafe {
        let mut size = 0;
        let mut received = 0;
        item.operation.TotalBytesToReceive(&mut size)?;
        item.operation.BytesReceived(&mut received)?;
        item.snapshot.size = size.max(0) as u64;
        item.snapshot.received = received.max(0) as u64;
        if item.pending.is_some() {
            return Ok(());
        }
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS;
        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_NONE;
        let mut resume = false.into();
        item.operation.State(&mut state)?;
        item.operation.InterruptReason(&mut reason)?;
        item.operation.CanResume(&mut resume)?;
        item.snapshot.can_resume = resume.as_bool();
        item.snapshot.status = match state {
            COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED => Status::Completed,
            COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS => Status::Downloading,
            _ if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED => Status::Paused,
            _ => Status::Failed,
        };
    }
    Ok(())
}

pub(super) async fn list(app: &AppHandle) -> Result<Vec<Snapshot>> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let items = TRANSFERS
            .with_borrow(|items| items.values().map(|item| item.snapshot.clone()).collect());
        if send.send(items).is_err() {
            eprintln!("Browser download list receiver closed");
        }
    })
    .map_err(|_| Error::Unavailable)?;
    receive.await.map_err(|_| Error::Unavailable)
}

pub(super) async fn completed_path(app: &AppHandle, id: String) -> Result<Option<PathBuf>> {
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let path = TRANSFERS.with_borrow(|items| {
            items
                .get(&id)
                .filter(|item| item.snapshot.status == Status::Completed)
                .map(|item| item.path.clone())
        });
        if send.send(path).is_err() {
            eprintln!("Browser download path receiver closed");
        }
    })
    .map_err(|_| Error::Unavailable)?;
    receive.await.map_err(|_| Error::Unavailable)
}

pub(super) async fn control(app: &AppHandle, id: String, action: Action) -> Result<()> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let events = app.clone();
    app.run_on_main_thread(move || {
        let result = execute(&id, action).and_then(|()| publish(&events, &id));
        if send.send(result.map_err(|_| Error::Unavailable)).is_err() {
            eprintln!("Browser download action receiver closed");
        }
    })
    .map_err(|_| Error::Unavailable)?;
    receive.await.map_err(|_| Error::Unavailable)?
}

fn execute(id: &str, action: Action) -> windows::core::Result<()> {
    // Take the record out before COM calls: synchronous StateChanged callbacks must not reborrow it.
    let Some(mut item) = TRANSFERS.with_borrow_mut(|items| items.remove(id)) else {
        return if matches!(action, Action::Remove) {
            Ok(())
        } else {
            Err(windows::core::Error::from_hresult(
                windows::Win32::Foundation::E_FAIL,
            ))
        };
    };
    let result = perform(&mut item, action);
    if !matches!(action, Action::Remove) || result.is_err() {
        TRANSFERS.with_borrow_mut(|items| items.insert(id.into(), item));
    }
    result
}

fn perform(item: &mut Transfer, action: Action) -> windows::core::Result<()> {
    // SAFETY: Called on the owning COM apartment with a live, retained download operation and deferral.
    unsafe {
        if matches!(action, Action::Remove) {
            if let Some((args, deferral)) = &item.pending {
                args.SetCancel(true)?;
                deferral.Complete()?;
                item.pending = None;
            } else if item.snapshot.status != Status::Completed {
                item.operation.Cancel()?;
            }
            return Ok(());
        }
        if let Some((_, deferral)) = &item.pending {
            if !matches!(action, Action::Toggle | Action::Resume | Action::Retry) {
                return Err(windows::core::Error::from_hresult(
                    windows::Win32::Foundation::E_INVALIDARG,
                ));
            }
            deferral.Complete()?;
            item.pending = None;
            item.snapshot.awaiting_confirmation = false;
            return Ok(());
        }
        if matches!(action, Action::Pause)
            || matches!(action, Action::Toggle) && item.snapshot.status == Status::Downloading
        {
            item.operation.Pause()
        } else if item.snapshot.can_resume {
            item.operation.Resume()
        } else {
            Err(windows::core::Error::from_hresult(
                windows::Win32::Foundation::E_FAIL,
            ))
        }
    }
}
