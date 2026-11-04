use super::{
    platform,
    protocol::{CommandOutput, CommandRequest, MAX_OUTPUT_BYTES},
    RemoteError, Result,
};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::io::{AsyncRead, AsyncReadExt};

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

fn working_directory(request: &CommandRequest) -> Result<PathBuf> {
    let path = request
        .cwd
        .as_ref()
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .ok_or(RemoteError::Execution)?;
    if !path.is_absolute() {
        return Err(RemoteError::InvalidRequest);
    }
    let path = path.canonicalize().map_err(|_| RemoteError::Execution)?;
    if !path.is_dir() {
        return Err(RemoteError::InvalidRequest);
    }
    Ok(path)
}

async fn capture(mut stream: impl AsyncRead + Unpin) -> Result<(String, bool)> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    let mut truncated = false;
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|_| RemoteError::Execution)?;
        if count == 0 {
            break;
        }
        let keep = count.min(MAX_OUTPUT_BYTES.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..keep]);
        truncated |= count > keep;
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// Cancellation is checked on a worker; neither shell execution nor pipe draining blocks the UI.
pub(super) async fn execute(
    request: CommandRequest,
    allowed: impl Fn() -> bool,
) -> Result<CommandOutput> {
    request.validate()?;
    execute_prevalidated(request, allowed).await
}

pub(super) async fn execute_prevalidated(
    request: CommandRequest,
    allowed: impl Fn() -> bool,
) -> Result<CommandOutput> {
    let cwd = working_directory(&request)?;
    if !allowed() {
        return Err(RemoteError::Cancelled);
    }
    let mut command = platform::command(&request.shell, &request.command)?;
    command.current_dir(cwd);
    let started = Instant::now();
    let mut child = platform::spawn(&mut command)
        .await
        .map_err(|_| RemoteError::Execution)?;
    let tree = platform::track(&child)?;
    let pid = child.id().ok_or(RemoteError::Execution)?;
    let stdout = child.stdout.take().ok_or(RemoteError::Execution)?;
    let stderr = child.stderr.take().ok_or(RemoteError::Execution)?;
    let stdout = tokio::spawn(capture(stdout));
    let stderr = tokio::spawn(capture(stderr));
    let result = wait(&mut child, &request, allowed).await;
    tree.finish();
    if !matches!(result, Ok(Some(_))) {
        platform::stop(&mut child, pid).await;
    }
    let captured = finish_capture(stdout, stderr).await;
    if captured.is_err() {
        platform::stop(&mut child, pid).await;
    }
    let status = result?;
    let ((stdout, stdout_cut), (stderr, stderr_cut)) = captured?;
    Ok(CommandOutput {
        stdout,
        stderr,
        exit_code: status.and_then(|status| status.code()),
        timed_out: status.is_none(),
        truncated: stdout_cut || stderr_cut,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

type Captured = (String, bool);
type CaptureTask = tokio::task::JoinHandle<Result<Captured>>;

async fn finish_capture(
    mut stdout: CaptureTask,
    mut stderr: CaptureTask,
) -> Result<(Captured, Captured)> {
    let result = tokio::time::timeout(DRAIN_TIMEOUT, async {
        Ok((
            (&mut stdout).await.map_err(|_| RemoteError::Execution)??,
            (&mut stderr).await.map_err(|_| RemoteError::Execution)??,
        ))
    })
    .await;
    // A descendant may inherit the pipe after the shell exits. Never detach a draining task forever.
    stdout.abort();
    stderr.abort();
    result.map_err(|_| RemoteError::Execution)?
}

async fn wait(
    child: &mut tokio::process::Child,
    request: &CommandRequest,
    allowed: impl Fn() -> bool,
) -> Result<Option<std::process::ExitStatus>> {
    let deadline = Instant::now() + Duration::from_secs(request.timeout_seconds);
    loop {
        if !allowed() {
            return Err(RemoteError::Cancelled);
        }
        if let Some(status) = child.try_wait().map_err(|_| RemoteError::Execution)? {
            return Ok(Some(status));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

#[cfg(test)]
#[path = "executor_tests.rs"]
mod tests;
