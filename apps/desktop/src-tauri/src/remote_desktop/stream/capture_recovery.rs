//! A Windows desktop switch replaces capture resources, not the authenticated WebRTC session.
use super::{encoder::Encoder, model::Profile, native::Stream};
use crate::remote_desktop::{DesktopError, Result};
use std::future::Future;
use std::{path::Path, time::Duration};
use tokio::sync::watch;

const RECOVERY_LIMIT: Duration = Duration::from_secs(15);
const RETRY_INTERVAL: Duration = Duration::from_millis(250);

pub(super) async fn display(id: &str) -> Result<super::super::monitors::Monitor> {
    if !super::capture_recovery::desktop_switch_recovery() {
        return read_display(id).await;
    }
    let (_owner, cancel) = watch::channel(false);
    retry(cancel, RECOVERY_LIMIT, || read_display(id)).await
}

async fn read_display(id: &str) -> Result<super::super::monitors::Monitor> {
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        super::super::with_session(&id, |session| session.display.refresh())
    })
    .await
    .map_err(|_| DesktopError::Platform)?
}

pub(super) async fn open(
    path: &Path,
    profile: Profile,
    display: &super::super::monitors::Monitor,
    id: &str,
) -> Result<(Encoder, Vec<u8>)> {
    if !super::capture_recovery::desktop_switch_recovery() {
        return Encoder::open(path, profile, display).await;
    }
    let (_owner, cancel) = watch::channel(false);
    retry(cancel, RECOVERY_LIMIT, || async {
        let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || super::super::with_lease(&id, |_| Ok(())))
            .await
            .map_err(|_| DesktopError::Platform)??;
        Encoder::open(path, profile, display).await
    })
    .await
}

pub(super) async fn reopen(
    stream: &Stream,
    path: &Path,
    encoder: &mut Encoder,
    profile: Profile,
) -> Result<Vec<u8>> {
    if !super::capture_recovery::desktop_switch_recovery() {
        return Err(DesktopError::Platform);
    }
    encoder.stop().await;
    let (next, first) = retry(stream.cancel.subscribe(), RECOVERY_LIMIT, || async {
        stream.keep_alive().await?;
        // A fresh helper binds its main thread before COM, capture or encoder initialization.
        Encoder::open(path, profile, &stream.display).await
    })
    .await?;
    *encoder = next;
    Ok(first)
}

async fn retry<T, F, A>(
    mut cancel: watch::Receiver<bool>,
    limit: Duration,
    mut attempt: F,
) -> Result<T>
where
    F: FnMut() -> A,
    A: Future<Output = Result<T>>,
{
    if *cancel.borrow() {
        return Err(DesktopError::Expired);
    }
    let recovery = async {
        loop {
            match attempt().await {
                Ok(value) => return Ok(value),
                Err(DesktopError::Platform) => tokio::time::sleep(RETRY_INTERVAL).await,
                Err(error) => return Err(error),
            }
        }
    };
    tokio::select! {
        _ = cancel.changed() => Err(DesktopError::Expired),
        result = tokio::time::timeout(limit, recovery) => result.map_err(|_| DesktopError::Platform)?,
    }
}

/// Only the Windows service can follow a switch to the secure input desktop.
pub(super) fn desktop_switch_recovery() -> bool {
    #[cfg(windows)]
    {
        super::super::input_desktop::is_worker()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reopens_after_desktop_transitions_but_never_retries_expired_authorization() {
        let (_cancel, receiver) = watch::channel(false);
        let mut attempts = 0;
        let value = retry(receiver.clone(), Duration::from_secs(2), || {
            attempts += 1;
            let result = if attempts < 3 {
                Err(DesktopError::Platform)
            } else {
                Ok("new frame")
            };
            async { result }
        })
        .await
        .unwrap();
        assert_eq!(value, "new frame");
        assert_eq!(attempts, 3);
        let denied = retry(receiver, RECOVERY_LIMIT, || async {
            Err::<(), _>(DesktopError::Expired)
        })
        .await;
        assert!(matches!(denied, Err(DesktopError::Expired)));
    }

    #[tokio::test]
    async fn cancellation_interrupts_an_unresponsive_capture_start() {
        let (cancel, receiver) = watch::channel(false);
        let task = tokio::spawn(retry(receiver, RECOVERY_LIMIT, || {
            std::future::pending::<Result<()>>()
        }));
        cancel.send_replace(true);
        let result = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(result, Err(DesktopError::Expired)));
    }
}
