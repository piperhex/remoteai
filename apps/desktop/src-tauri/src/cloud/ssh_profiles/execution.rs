//! Cloud reads retry independently of command delivery; only pre-dispatch SSH errors permit recovery.
use super::{
    agent::{self, Target},
    *,
};
use csw_ssh_client::{Client as SshClient, Execution, ExecutionError, ExecutionOptions};
use std::sync::Arc;

const SYNC_RETRIES: usize = 3;
const RETRY_DELAY: Duration = Duration::from_millis(250);

#[derive(Debug, thiserror::Error)]
pub(crate) enum AgentError {
    #[error(transparent)]
    Profile(#[from] ProfileError),
    #[error(transparent)]
    Ssh(#[from] ExecutionError),
}

pub(super) fn retry_sync<T>(
    mut operation: impl FnMut() -> Result<T, ProfileError>,
) -> Result<T, ProfileError> {
    let mut retry = 0;
    loop {
        match operation() {
            Err(ProfileError::Unavailable | ProfileError::CredentialsUnavailable)
                if retry < SYNC_RETRIES =>
            {
                std::thread::sleep(RETRY_DELAY * (1 << retry));
                retry += 1;
            }
            result => return result,
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ProfileError> + Send + 'static,
) -> Result<T, AgentError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| ProfileError::Unavailable)?
        .map_err(Into::into)
}

pub(crate) async fn agent_ssh_execute(
    app: tauri::AppHandle,
    id: String,
    revision: u64,
    options: ExecutionOptions,
) -> Result<Execution, AgentError> {
    let target = Target { id, revision };
    let host = app.clone();
    let (session, request, cached) = blocking({
        let target = target.clone();
        move || {
            let session = agent::session(&host)?;
            let (request, cached) = session.prepare(&host, &target)?;
            Ok((session, request, cached))
        }
    })
    .await?;
    let client = app.state::<Arc<SshClient>>().inner().clone();
    let result = client.execute_attempt(request, options.clone()).await;
    if result.as_ref().is_err_and(|error| error.retryable()) {
        let host = app.clone();
        let request = blocking(move || session.refresh(&host, &target)).await?;
        // The first attempt never sent the command. Recovery cannot replay a dispatched command.
        return client
            .execute_attempt(request, options)
            .await
            .map_err(Into::into);
    }
    if cached {
        session.refresh_later(&app, Some(target));
    }
    result.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_budget_is_initial_attempt_plus_three_and_permanent_errors_stop_immediately() {
        let mut attempts = 0;
        let result: Result<(), _> = retry_sync(|| {
            attempts += 1;
            Err(ProfileError::Unavailable)
        });
        assert!(result.is_err());
        assert_eq!(attempts, 4);
        attempts = 0;
        let result: Result<(), _> = retry_sync(|| {
            attempts += 1;
            Err(ProfileError::Conflict)
        });
        assert!(matches!(result, Err(ProfileError::Conflict)));
        assert_eq!(attempts, 1);
    }
}
