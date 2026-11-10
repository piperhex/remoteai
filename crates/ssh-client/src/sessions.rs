use crate::{
    connection::{self, HostKey, TIMEOUT},
    files,
    types::*,
};
use russh::{client, Channel, ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{mpsc, oneshot, Mutex, Semaphore};

pub type Sink = Arc<dyn Fn(Event) -> bool + Send + Sync>;
struct Input {
    command: Command,
    reply: oneshot::Sender<Result<()>>,
}
struct Session {
    input: mpsc::Sender<Input>,
    ssh: Arc<client::Handle<HostKey>>,
    files: Mutex<Option<files::FileSession>>,
    x11: Option<crate::x11::Lease>,
}

/// A registry owns connections; a bounded actor serializes each terminal's input and resize requests.
pub struct Client {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    pub(crate) slots: Arc<Semaphore>,
}
impl Default for Client {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(MAX_SESSIONS)),
        }
    }
}
impl Client {
    pub async fn open(self: &Arc<Self>, request: Connect, sink: Sink) -> Result<Info> {
        self.open_session(request, sink, Start::Integrated).await
    }

    /// Open a plain PTY shell or a PTY command that remains available for subsequent input.
    /// Opening is never retried: the remote shell or command may already have started on failure.
    pub async fn open_pty(
        self: &Arc<Self>,
        request: Connect,
        command: Option<String>,
        sink: Sink,
    ) -> Result<Info> {
        if request.x11.is_some() {
            return Err(Error::Invalid);
        }
        if let Some(command) = &command {
            crate::ExecutionOptions {
                command: command.clone(),
                timeout_seconds: 30,
            }
            .validate()?;
        }
        self.open_session(request, sink, Start::Plain(command))
            .await
    }

    async fn open_session(
        self: &Arc<Self>,
        request: Connect,
        sink: Sink,
        start: Start,
    ) -> Result<Info> {
        request.validate()?;
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Limit)?;
        let (ssh, channel, x11) =
            tokio::time::timeout(TIMEOUT, open_shell(&request, sink.clone(), start))
                .await
                .map_err(|_| Error::Connection)??;
        let (input, receive) = mpsc::channel(16);
        let session = Arc::new(Session {
            input,
            ssh: Arc::new(ssh),
            files: Mutex::new(None),
            x11,
        });
        let id = format!("ssh-{}", uuid::Uuid::new_v4());
        self.sessions
            .lock()
            .await
            .insert(id.clone(), session.clone());
        let state = self.clone();
        let task_id = id.clone();
        tokio::spawn(async move {
            let _permit = permit;
            run_shell(channel, receive, &sink).await;
            // File cleanup can wait for an in-flight SFTP operation; forwarded
            // applications must stop as soon as their terminal has ended.
            if let Some(x11) = &session.x11 {
                x11.0.stop();
            }
            state.sessions.lock().await.remove(&task_id);
            if let Some(files) = session.files.lock().await.as_mut() {
                files.cleanup().await;
            }
            if session
                .ssh
                .disconnect(Disconnect::ByApplication, "", "")
                .await
                .is_err()
            {
                // A server-initiated disconnect is an expected terminal exit.
            }
        });
        Ok(Info {
            id,
            cwd: String::new(),
            shell: "SSH".into(),
            ssh: Remote {
                host: request.endpoint.host.clone(),
                port: request.endpoint.port,
                username: request.username.clone(),
            },
        })
    }

    async fn get(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or(Error::Closed)
    }

    pub async fn command(&self, command: Command) -> Result<()> {
        let id = match &command {
            Command::Write { id, data } => {
                if data.len() > MAX_INPUT_BYTES {
                    return Err(Error::Invalid);
                }
                id
            }
            Command::WriteBinary { id, data } => {
                if data.len() > MAX_INPUT_BYTES {
                    return Err(Error::Invalid);
                }
                id
            }
            Command::OutputAck { id, bytes } => {
                if *bytes > MAX_INPUT_BYTES {
                    return Err(Error::Invalid);
                }
                id
            }
            Command::OutputFlow { id, .. } => id,
            Command::Resize { id, size } => {
                size.validate()?;
                id
            }
            Command::Close { id } => id,
        };
        let session = match self.get(id).await {
            Ok(session) => session,
            Err(_) if matches!(command, Command::Close { .. }) => return Ok(()),
            Err(error) => return Err(error),
        };
        let (reply, result) = oneshot::channel();
        tokio::time::timeout(TIMEOUT, async {
            session
                .input
                .send(Input { command, reply })
                .await
                .map_err(|_| Error::Closed)?;
            result.await.map_err(|_| Error::Closed)?
        })
        .await
        .map_err(|_| Error::Connection)?
    }

    pub async fn files(&self, id: &str, action: FileAction) -> Result<FileReply> {
        let session = self.get(id).await?;
        // Let a mutation finish (or roll back) even if its caller times out or disconnects.
        let operation = tokio::spawn(async move {
            let mut sftp = session.files.lock().await;
            if sftp.is_none() {
                let channel = session
                    .ssh
                    .channel_open_session()
                    .await
                    .map_err(|_| Error::File)?;
                channel
                    .request_subsystem(true, "sftp")
                    .await
                    .map_err(|_| Error::File)?;
                *sftp = Some(files::FileSession::new(
                    SftpSession::new(channel.into_stream())
                        .await
                        .map_err(|_| Error::File)?,
                ));
            }
            sftp.as_mut().ok_or(Error::File)?.perform(action).await
        });
        tokio::time::timeout(TIMEOUT, operation)
            .await
            .map_err(|_| Error::File)?
            .map_err(|_| Error::File)?
    }
}

enum Start {
    Integrated,
    Plain(Option<String>),
}

async fn open_shell(
    request: &Connect,
    sink: Sink,
    start: Start,
) -> Result<(
    client::Handle<HostKey>,
    Channel<client::Msg>,
    Option<crate::x11::Lease>,
)> {
    let x11 = match &request.x11 {
        Some(options) => Some(crate::x11::State::prepare(options, sink.clone()).await?),
        None => None,
    };
    let forwarder = x11
        .as_ref()
        .map(|lease| crate::x11::Forwarder::new(lease.0.clone()));
    let session = connection::connect(request, forwarder).await?;
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|_| Error::Connection)?;
    if let Some(x11) = &x11 {
        x11.0.request(&mut channel).await?;
    }
    channel
        .request_pty(
            true,
            "xterm-256color",
            u32::from(request.size.cols),
            u32::from(request.size.rows),
            0,
            0,
            &[],
        )
        .await
        .map_err(|_| Error::Connection)?;
    match start {
        Start::Integrated => crate::shell_integration::start(&session, &channel).await?,
        Start::Plain(command) => {
            wait_success(&mut channel, &sink).await?;
            match command {
                Some(command) => channel.exec(true, command).await,
                None => channel.request_shell(true).await,
            }
            .map_err(|_| Error::Connection)?;
            wait_success(&mut channel, &sink).await?;
        }
    }
    Ok((session, channel, x11))
}

async fn wait_success(channel: &mut Channel<client::Msg>, sink: &Sink) -> Result<()> {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => return Ok(()),
            Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. }) => {
                if !sink(Event::Output {
                    data: data.to_vec(),
                }) {
                    return Err(Error::Closed);
                }
            }
            Some(ChannelMsg::Failure | ChannelMsg::Close | ChannelMsg::Eof) | None => {
                return Err(Error::Connection)
            }
            _ => {}
        }
    }
}

async fn run_shell(
    mut channel: Channel<client::Msg>,
    mut input: mpsc::Receiver<Input>,
    sink: &Sink,
) {
    let mut code = None;
    let mut credit = None;
    let mut expiry = tokio::time::Instant::now() + TIMEOUT;
    loop {
        tokio::select! {
            request = input.recv() => {
                let Some(request) = request else { break };
                match &request.command {
                    Command::OutputFlow { enabled, .. } => credit = enabled.then_some(MAX_INPUT_BYTES),
                    Command::OutputAck { bytes, .. } => {
                        if let Some(value) = credit.as_mut() {
                            *value = (*value + bytes).min(MAX_INPUT_BYTES);
                        }
                    }
                    _ => {}
                }
                expiry = tokio::time::Instant::now() + TIMEOUT;
                if matches!(&request.command, Command::Write { data, .. } if !data.is_empty())
                    && !sink(Event::Output { data: crate::shell_integration::INPUT_MARKER.to_vec() }) {
                    break;
                }
                let closing = matches!(request.command, Command::Close { .. });
                let result = tokio::time::timeout(TIMEOUT, send_input(&channel, request.command)).await
                    .map_err(|_| Error::Connection).and_then(|value| value);
                let failed = result.is_err();
                // A timed-out caller may have dropped its reply; the actor still completes the input exactly once.
                let _ = request.reply.send(result);
                if closing || failed { break; }
            }
            _ = tokio::time::sleep_until(expiry), if credit.is_some() => credit = None,
            message = channel.wait(), if credit != Some(0) => match message {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    if let Some(value) = credit.as_mut() { *value = value.saturating_sub(data.len()); }
                    if !sink(Event::Output { data: data.to_vec() }) { break; }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status),
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    }
    sink(Event::Exit { code });
}

async fn send_input(channel: &Channel<client::Msg>, command: Command) -> Result<()> {
    match command {
        Command::Write { data, .. } => channel.data(data.as_bytes()).await,
        Command::WriteBinary { data, .. } => {
            let data = zeroize::Zeroizing::new(data);
            channel.data(data.as_slice()).await
        }
        Command::OutputFlow { .. } | Command::OutputAck { .. } => return Ok(()),
        Command::Resize { size, .. } => {
            channel
                .window_change(u32::from(size.cols), u32::from(size.rows), 0, 0)
                .await
        }
        Command::Close { .. } => channel.close().await,
    }
    .map_err(|_| Error::Connection)
}
