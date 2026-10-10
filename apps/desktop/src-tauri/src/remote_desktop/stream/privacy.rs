//! Display changes are serialized with encoding and preserve the existing peer and media tracks.
use super::{encoder::Encoder, native::Stream};
use crate::remote_desktop::{privacy, DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot};

pub(super) struct Change {
    enabled: bool,
    reply: oneshot::Sender<Result<privacy::Snapshot>>,
}

pub(super) struct Pending {
    ticket: String,
    reply: oneshot::Receiver<Result<privacy::Snapshot>>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    ticket: String,
    pending: bool,
    snapshot: Option<privacy::Snapshot>,
}

#[tauri::command]
pub(crate) async fn remote_desktop_privacy(
    id: String,
    enabled: Option<bool>,
    ticket: Option<String>,
) -> std::result::Result<Progress, String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_privacy",
            &id,
            serde_json::json!({"enabled": enabled, "ticket": ticket}),
        )
        .await;
    }
    request(&id, enabled, ticket.as_deref())
        .await
        .map_err(crate::remote_desktop::safe_error)
}

async fn request(id: &str, enabled: Option<bool>, ticket: Option<&str>) -> Result<Progress> {
    if ticket.is_some_and(|value| value.len() > 64) {
        return Err(DesktopError::Invalid);
    }
    let stream = super::current(id).await?;
    let mut pending = stream.privacy_pending.lock().await;
    match (enabled, ticket) {
        (None, Some(ticket)) => return poll(&mut pending, ticket),
        (Some(_), None) if pending.is_none() => {}
        _ => return Err(DesktopError::Invalid),
    }
    let enabled = enabled.ok_or(DesktopError::Invalid)?;
    authorize(&stream, enabled).await?;
    let (reply, result) = oneshot::channel();
    stream
        .privacy
        .try_send(Change { enabled, reply })
        .map_err(|_| DesktopError::Busy)?;
    let ticket = uuid::Uuid::new_v4().to_string();
    *pending = Some(Pending {
        ticket: ticket.clone(),
        reply: result,
    });
    Ok(Progress {
        ticket,
        pending: true,
        snapshot: None,
    })
}

async fn authorize(stream: &Arc<Stream>, _enabled: bool) -> Result<()> {
    let id = &stream.id;
    let session_id = id.to_owned();
    #[cfg(windows)]
    let runtime = stream.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::remote_desktop::with_lease(&session_id, |session| {
            if !session.permissions.control {
                return Err(DesktopError::Denied);
            }
            #[cfg(windows)]
            if !crate::remote_desktop::input_desktop::is_worker() {
                return Err(DesktopError::PrivacyService);
            }
            Ok(())
        })?;
        // Release the session lock before checking/installing. A confirmation request returns
        // before queueing a display change, so capture and the ordinary desktop remain usable.
        #[cfg(windows)]
        if _enabled {
            crate::remote_desktop::privacy_setup::prepare(&runtime)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| DesktopError::Privacy)?
}

fn poll(pending: &mut Option<Pending>, ticket: &str) -> Result<Progress> {
    let current = pending
        .as_mut()
        .filter(|current| current.ticket == ticket)
        .ok_or(DesktopError::Expired)?;
    let result = match current.reply.try_recv() {
        Ok(result) => result,
        Err(oneshot::error::TryRecvError::Empty) => {
            return Ok(Progress {
                ticket: ticket.to_owned(),
                pending: true,
                snapshot: None,
            })
        }
        Err(oneshot::error::TryRecvError::Closed) => Err(DesktopError::Expired),
    };
    *pending = None;
    Ok(Progress {
        ticket: ticket.to_owned(),
        pending: false,
        snapshot: Some(result?),
    })
}

pub(super) async fn apply(
    stream: &Arc<Stream>,
    path: &Path,
    encoder: &mut Encoder,
    request: Change,
) -> Result<()> {
    // Keep viewer authorization and the guardian alive while the encoder is stopped.
    let transaction = tokio::time::timeout(
        Duration::from_secs(45),
        switch(stream, path, encoder, request.enabled),
    );
    tokio::pin!(transaction);
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    let mut cancel = stream.cancel.subscribe();
    let result = loop {
        tokio::select! {
            result = &mut transaction => break result.unwrap_or(Err(DesktopError::Privacy)),
            _ = tick.tick() => if let Err(error) = stream.keep_alive().await { break Err(error); },
            _ = cancel.changed() => break Err(DesktopError::Expired),
        }
    };
    // A failed transition must close the lease: the guardian then locks before restoring.
    // Never claim an ordinary stream is running while its display topology is uncertain.
    let failed = result.is_err();
    if request.reply.send(result).is_err() {
        return Err(DesktopError::Expired);
    }
    if failed {
        return Err(DesktopError::Privacy);
    }
    Ok(())
}

async fn switch(
    stream: &Stream,
    path: &Path,
    encoder: &mut Encoder,
    enabled: bool,
) -> Result<privacy::Snapshot> {
    let id = stream.id.clone();
    let current = tauri::async_runtime::spawn_blocking(move || {
        crate::remote_desktop::with_lease(&id, |session| {
            if !session.permissions.control {
                return Err(DesktopError::Denied);
            }
            Ok(session.privacy.is_some())
        })
    })
    .await
    .map_err(|_| DesktopError::Privacy)??;
    if current == enabled {
        return snapshot(&stream.id).await;
    }
    encoder.stop().await;
    if enabled {
        let (id, runtime) = (stream.id.clone(), path.to_owned());
        tauri::async_runtime::spawn_blocking(move || privacy::prepare(&id, &runtime))
            .await
            .map_err(|_| DesktopError::Privacy)??;
        // Verify capture before disconnecting physical screens. Discard these probe frames.
        reopen(stream, path, encoder).await?;
        encoder.stop().await;
    }
    let id = stream.id.clone();
    let state = tauri::async_runtime::spawn_blocking(move || {
        if enabled {
            privacy::commit(&id)
        } else {
            privacy::disable(&id)
        }
    })
    .await
    .map_err(|_| DesktopError::Privacy)??;
    let first = reopen(stream, path, encoder).await?;
    super::pump::send_frame(stream, first).await?;
    Ok(state)
}

async fn snapshot(id: &str) -> Result<privacy::Snapshot> {
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        crate::remote_desktop::with_lease(&id, |session| privacy::snapshot(session))
    })
    .await
    .map_err(|_| DesktopError::Privacy)?
}

async fn reopen(stream: &Stream, path: &Path, encoder: &mut Encoder) -> Result<Vec<u8>> {
    let display = super::capture_recovery::display(&stream.id).await?;
    let profile = *stream.profile.borrow();
    let (next, first) = Encoder::open(path, profile, &display).await?;
    stream.display.send_replace(display);
    *encoder = next;
    Ok(first)
}

pub(super) fn channel() -> (mpsc::Sender<Change>, mpsc::Receiver<Change>) {
    mpsc::channel(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polling_is_nonblocking_and_only_the_current_ticket_can_consume_the_result() {
        let (reply, receiver) = oneshot::channel();
        let mut pending = Some(Pending {
            ticket: "current".into(),
            reply: receiver,
        });
        assert!(poll(&mut pending, "current").unwrap().pending);
        assert!(matches!(
            poll(&mut pending, "stale"),
            Err(DesktopError::Expired)
        ));
        let snapshot = privacy::Snapshot {
            displays: vec![],
            display_id: "virtual".into(),
            privacy_screen: true,
        };
        assert!(reply.send(Ok(snapshot)).is_ok());
        let completed = poll(&mut pending, "current").unwrap();
        assert!(!completed.pending);
        assert!(completed.snapshot.unwrap().privacy_screen);
        assert!(pending.is_none());
    }

    #[test]
    fn failed_or_abandoned_transitions_never_report_privacy_as_enabled() {
        let (reply, receiver) = oneshot::channel();
        let mut pending = Some(Pending {
            ticket: "failed".into(),
            reply: receiver,
        });
        assert!(reply.send(Err(DesktopError::Denied)).is_ok());
        assert!(matches!(
            poll(&mut pending, "failed"),
            Err(DesktopError::Denied)
        ));
        assert!(pending.is_none());
        let (reply, receiver) = oneshot::channel();
        pending = Some(Pending {
            ticket: "dropped".into(),
            reply: receiver,
        });
        drop(reply);
        assert!(matches!(
            poll(&mut pending, "dropped"),
            Err(DesktopError::Expired)
        ));
        assert!(pending.is_none());
    }
}
