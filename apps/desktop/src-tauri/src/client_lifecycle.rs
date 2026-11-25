//! Bound user-visible launch waits without allowing a second launch behind a stuck worker.

use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::Duration;

const CLIENT_OPERATION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub(crate) enum ClientOperationError {
    #[error("ChatGPT 正在启动或切换，请稍后再试。")]
    Busy,
    #[error("ChatGPT 启动等待超时，请检查是否已打开。若仍未启动，请重新打开 Remote AI 后再试。")]
    TimedOut,
    #[error("暂时无法启动 ChatGPT，请稍后重试。")]
    Unavailable,
}

/// Never queue a destructive restart behind another account or runtime operation.
pub(crate) fn try_lock(lock: &Mutex<()>) -> Result<MutexGuard<'_, ()>, ClientOperationError> {
    match lock.try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::WouldBlock) => Err(ClientOperationError::Busy),
        Err(TryLockError::Poisoned(_)) => Err(ClientOperationError::Unavailable),
    }
}

/// Blocking OS calls can outlive the UI wait. Their worker must retain its account/runtime
/// guards until it actually exits; a timeout must never authorize an overlapping restart.
pub(crate) async fn run<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    run_with_timeout(operation, CLIENT_OPERATION_TIMEOUT).await
}

pub(crate) async fn run_with_timeout<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
    timeout: Duration,
) -> Result<T, String> {
    let mut task = tauri::async_runtime::spawn_blocking(operation);
    match tokio::time::timeout(timeout, &mut task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            eprintln!("ChatGPT lifecycle worker failed: {error}");
            Err(ClientOperationError::Unavailable.to_string())
        }
        Err(_) => {
            // Cancel queued work. Already-running blocking work keeps its guards until exit.
            task.abort();
            eprintln!(
                "ChatGPT lifecycle operation exceeded {} seconds",
                timeout.as_secs()
            );
            Err(ClientOperationError::TimedOut.to_string())
        }
    }
}

#[cfg(test)]
mod tests;
