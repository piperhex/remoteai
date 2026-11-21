use crate::{
    connection::{HostKey, TIMEOUT},
    types::{Error, FileAction, FileReply, Result},
    uploads::Uploads,
};
use russh::{client, Disconnect};
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tokio::{
    sync::{mpsc, oneshot, watch},
    task::JoinHandle,
    time::{timeout, timeout_at, Instant},
};

// A waiting request may contain a complete Base64 upload. Reject excess calls before retaining it.
const FILE_QUEUE_CAPACITY: usize = 2;

struct Request {
    action: FileAction,
    deadline: Instant,
    reply: oneshot::Sender<Result<FileReply>>,
}

impl Request {
    fn expired(&self) -> bool {
        self.reply.is_closed() || Instant::now() >= self.deadline
    }
}

pub(crate) struct FileRequests(mpsc::Sender<Request>);

pub(crate) struct FileWorker {
    stop: watch::Sender<()>,
    task: JoinHandle<()>,
}

impl FileRequests {
    pub(crate) fn start(ssh: Arc<client::Handle<HostKey>>) -> (Self, FileWorker) {
        let (sender, receiver) = mpsc::channel(FILE_QUEUE_CAPACITY);
        let (stop, closing) = watch::channel(());
        let task = tokio::spawn(run(ssh, receiver, closing));
        (Self(sender), FileWorker { stop, task })
    }

    pub(crate) async fn perform(&self, action: FileAction) -> Result<FileReply> {
        let (reply, result) = oneshot::channel();
        let deadline = Instant::now() + TIMEOUT;
        self.0
            .try_send(Request {
                action,
                deadline,
                reply,
            })
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => Error::FileBusy,
                mpsc::error::TrySendError::Closed(_) => Error::Closed,
            })?;
        timeout_at(deadline, result)
            .await
            .map_err(|_| Error::File)?
            .map_err(|_| Error::Closed)?
    }
}

impl FileWorker {
    pub(crate) async fn shutdown(self, ssh: &client::Handle<HostKey>) {
        let Self { stop, mut task } = self;
        drop(stop);
        // Allow an active mutation to publish or roll back, then clean up pending uploads.
        let stalled = timeout(TIMEOUT, &mut task).await.is_err();
        // The transport may already be gone after a remote exit.
        let _disconnect = timeout(TIMEOUT, ssh.disconnect(Disconnect::ByApplication, "", "")).await;
        if stalled && timeout(TIMEOUT, &mut task).await.is_err() {
            task.abort();
            // Finish dropping the worker before the SSH session slot can be reused.
            let _cancelled = task.await;
        }
    }
}

async fn connect(ssh: &client::Handle<HostKey>) -> Result<SftpSession> {
    let channel = ssh.channel_open_session().await.map_err(|_| Error::File)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|_| Error::File)?;
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|_| Error::File)
}

async fn run(
    ssh: Arc<client::Handle<HostKey>>,
    mut requests: mpsc::Receiver<Request>,
    mut closing: watch::Receiver<()>,
) {
    let mut sftp = None;
    let mut uploads = Uploads::default();
    loop {
        let mut request = tokio::select! {
            biased;
            _ = closing.changed() => break,
            request = requests.recv() => match request { Some(value) => value, None => break },
        };
        if request.expired() {
            drop(request.reply.send(Err(Error::File)));
            continue;
        }
        if sftp.is_none() {
            let opened = tokio::select! {
                biased;
                _ = closing.changed() => break,
                _ = request.reply.closed() => continue,
                value = timeout_at(request.deadline, connect(&ssh)) => value,
            };
            match opened {
                Ok(Ok(session)) => sftp = Some(session),
                _ => {
                    // A timed-out caller may have already dropped its receiver.
                    drop(request.reply.send(Err(Error::File)));
                    continue;
                }
            }
        }
        if let Some(session) = &sftp {
            uploads.cleanup(session, false).await;
            if !perform(session, &mut uploads, request, &mut closing).await {
                // A cancelled read can leave a server-side directory handle or unanswered packet.
                // Discard the SFTP channel but preserve upload tokens for the next connection.
                sftp = None;
            }
        }
    }
    drop(requests);
    cleanup(&ssh, uploads, sftp).await;
}

async fn cleanup(ssh: &client::Handle<HostKey>, mut uploads: Uploads, sftp: Option<SftpSession>) {
    if uploads.is_empty() {
        return;
    }
    let session = match sftp {
        Some(session) => Ok(session),
        None => connect(ssh).await,
    };
    match session {
        Ok(session) => uploads.cleanup(&session, true).await,
        Err(_) => eprintln!("SSH temporary upload cleanup could not reconnect"),
    }
}

async fn perform(
    session: &SftpSession,
    uploads: &mut Uploads,
    request: Request,
    closing: &mut watch::Receiver<()>,
) -> bool {
    if closing.has_changed().is_err() {
        return true;
    }
    if request.expired() {
        drop(request.reply.send(Err(Error::File)));
        return true;
    }
    let Request {
        action,
        deadline,
        mut reply,
    } = request;
    let read_only = matches!(
        action,
        FileAction::List { .. } | FileAction::Read { .. } | FileAction::ReadChunk { .. }
    );
    let operation = crate::files::perform(session, uploads, action);
    let result = if read_only {
        tokio::select! {
            biased;
            _ = closing.changed() => return false,
            _ = reply.closed() => return false,
            result = timeout_at(deadline, operation) => match result {
                Ok(result) => result,
                Err(_) => {
                    drop(reply.send(Err(Error::File)));
                    return false;
                }
            },
        }
    } else {
        operation.await
    };
    // Started writes finish even when their caller can no longer receive the result.
    drop(reply.send(result));
    true
}

#[cfg(test)]
mod tests;
