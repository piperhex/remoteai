use super::super::{platform, session, state, ComputerError, Result};
use super::{
    lease::{self, Lease},
    native::Process,
    pipe, verified_package, Bootstrap,
};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::windows::named_pipe::NamedPipeServer,
};

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_CONNECTIONS: usize = 32;

struct Context<'a> {
    root: &'a Path,
    id: &'a str,
    lease: &'a Lease,
    executable: &'a Path,
}

pub(super) async fn run(channel: uuid::Uuid, owner_id: u32) -> Result<()> {
    let owner = Process::open(owner_id)?;
    owner.trusted()?;
    let current = Process::open(std::process::id())?;
    if !current.elevated()? {
        return Err(ComputerError::Administrator);
    }
    let mut bootstrap = pipe::connect(channel, owner_id).await?;
    let request: Bootstrap = pipe::read(&mut bootstrap).await?;
    #[cfg(debug_assertions)]
    let root = request.root.clone();
    #[cfg(not(debug_assertions))]
    let root = super::super::root()?;
    let record = state::read(&root, &request.home_id)?.ok_or(ComputerError::Disabled)?;
    if !record.enabled || !record.administrator || record.generation != request.generation {
        return Err(ComputerError::Disabled);
    }
    // Keep verified binaries open without write/delete sharing for the entire grant.
    let package = verified_package::lock(&root)?;
    let lease = Lease {
        id: uuid::Uuid::new_v4(),
        generation: request.generation,
        owner: owner_id,
        owner_started: owner.started()?,
        broker: std::process::id(),
        broker_started: current.started()?,
    };
    let server = pipe::server(lease.id, true)?;
    pipe::write(&mut bootstrap, &lease).await?;
    let deadline = tokio::time::Instant::now() + pipe::CONNECT_TIMEOUT;
    while !lease::matches(&root, &request.home_id, &lease) {
        if !owner.alive() || tokio::time::Instant::now() >= deadline {
            return Err(ComputerError::Disabled);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    serve(
        Context {
            root: &root,
            id: &request.home_id,
            lease: &lease,
            executable: &package.executable,
        },
        server,
    )
    .await
}

async fn serve(context: Context<'_>, mut server: NamedPipeServer) -> Result<()> {
    let Context {
        root,
        id,
        lease,
        executable,
    } = context;
    let owner = Process::open(lease.owner)?;
    let shutdown = platform::shutdown_signal()?;
    let mut tasks = tokio::task::JoinSet::new();
    let mut tick = tokio::time::interval(POLL_INTERVAL);
    let result = loop {
        tokio::select! {
            _ = tick.tick() => {
                if !owner.alive() || !lease::matches(root, id, lease)
                    || shutdown.load(std::sync::atomic::Ordering::Acquire) { break Ok(()); }
            }
            connected = server.connect() => {
                let next = match pipe::server(lease.id, false) {
                    Ok(next) => next, Err(error) => break Err(error),
                };
                let previous = std::mem::replace(&mut server, next);
                if connected.is_err() || tasks.len() >= MAX_CONNECTIONS { continue; }
                let executable = executable.to_owned();
                tasks.spawn(async move { connection(&executable, previous).await });
            }
            Some(result) = tasks.join_next(), if !tasks.is_empty() => {
                if !matches!(result, Ok(Ok(()))) { eprintln!("Computer-use administrator connection ended"); }
            }
        }
    };
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    result
}

async fn connection(executable: &Path, mut pipe: NamedPipeServer) -> Result<()> {
    pipe::client(&pipe)?;
    let mut child = tokio::process::Command::from(session::command_for_executable(executable))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ComputerError::Startup)?;
    let mut input = child.stdin.take().ok_or(ComputerError::Startup)?;
    let mut output = child.stdout.take().ok_or(ComputerError::Startup)?;
    pipe.write_all(&[1])
        .await
        .map_err(|_| ComputerError::Administrator)?;
    let (mut reader, mut writer) = tokio::io::split(pipe);
    tokio::select! {
        _ = tokio::io::copy(&mut reader, &mut input) => {},
        _ = tokio::io::copy(&mut output, &mut writer) => {},
        _ = child.wait() => {},
    }
    // Closing stdin lets CUA release its native helpers. Bound the wait for stuck tools.
    drop(input);
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        child.kill().await.map_err(|_| ComputerError::Startup)?;
    }
    Ok(())
}

pub(super) async fn forward(root: &Path, id: &str, lease: Lease) -> Result<()> {
    let mut connection = pipe::connect(lease.id, lease.broker).await?;
    let ready = tokio::time::timeout(pipe::CONNECT_TIMEOUT, connection.read_u8())
        .await
        .map_err(|_| ComputerError::Administrator)?
        .map_err(|_| ComputerError::Administrator)?;
    if ready != 1 {
        return Err(ComputerError::Administrator);
    }
    let (mut reader, mut writer) = tokio::io::split(connection);
    let (mut input, mut output) = (tokio::io::stdin(), tokio::io::stdout());
    let shutdown = platform::shutdown_signal()?;
    tokio::select! {
        _ = tokio::io::copy(&mut input, &mut writer) => {},
        _ = tokio::io::copy(&mut reader, &mut output) => {},
        _ = async {
            while lease::active(root, id).is_some_and(|current| current.id == lease.id)
                && !shutdown.load(std::sync::atomic::Ordering::Acquire) {
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        } => {},
    }
    Ok(())
}
