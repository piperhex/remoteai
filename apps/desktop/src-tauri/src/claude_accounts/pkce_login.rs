use super::{
    login::{normalize_code, LoginStatus},
    oauth, store, Error, Result,
};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

struct Pending {
    pkce: Option<oauth::Pkce>,
    expected: Option<String>,
    status: LoginStatus,
    started: Instant,
    cancelled: bool,
}
static PENDING: OnceLock<Mutex<HashMap<String, Arc<Mutex<Pending>>>>> = OnceLock::new();
const TIMEOUT: Duration = Duration::from_secs(600);

fn pending(id: &str) -> Result<Arc<Mutex<Pending>>> {
    PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| Error::Busy)?
        .get(id)
        .cloned()
        .ok_or(Error::Expired)
}

pub(super) fn start(expected: Option<String>) -> Result<LoginStatus> {
    if expected.as_ref().is_some_and(|id| !store::is_claude_id(id)) {
        return Err(Error::Invalid);
    }
    let pkce = oauth::pkce()?;
    let id = format!("oauth_{}", uuid::Uuid::new_v4().simple());
    let status = LoginStatus {
        login_id: id.clone(),
        status: "waiting",
        authorization_url: Some(pkce.url.clone()),
        account_id: None,
        error: None,
    };
    let mut map = PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| Error::Busy)?;
    map.retain(|_, pending| {
        pending.lock().is_ok_and(|value| {
            value.started.elapsed() < TIMEOUT
                && !["complete", "failed", "cancelled"].contains(&value.status.status)
        })
    });
    if map.len() >= 8 {
        return Err(Error::Busy);
    }
    map.insert(
        id,
        Arc::new(Mutex::new(Pending {
            pkce: Some(pkce),
            expected,
            status: status.clone(),
            started: Instant::now(),
            cancelled: false,
        })),
    );
    Ok(status)
}

pub(super) fn poll(id: &str) -> Result<LoginStatus> {
    let pending = pending(id)?;
    let pending = pending.lock().map_err(|_| Error::Busy)?;
    if pending.started.elapsed() >= TIMEOUT {
        return Err(Error::Expired);
    }
    Ok(pending.status.clone())
}

pub(super) fn submit(root: &Path, id: &str, input: &str) -> Result<String> {
    let session = pending(id)?;
    let (pkce, code, expected) = {
        let mut pending = session.lock().map_err(|_| Error::Busy)?;
        if pending.cancelled || pending.started.elapsed() >= TIMEOUT {
            return Err(Error::Expired);
        }
        let pkce = pending.pkce.as_ref().ok_or(Error::Busy)?;
        let normalized = normalize_code(input, &pkce.url)?;
        let code = normalized
            .split('#')
            .next()
            .ok_or(Error::Invalid)?
            .to_string();
        pending.status.status = "verifying";
        (
            pending.pkce.take().ok_or(Error::Busy)?,
            code,
            pending.expected.clone(),
        )
    };
    let result = oauth::exchange(&pkce, &code);
    let mut pending = session.lock().map_err(|_| Error::Busy)?;
    if pending.cancelled || pending.started.elapsed() >= TIMEOUT {
        return Err(Error::Expired);
    }
    let result = result.and_then(|(mut credentials, profile)| {
        credentials.subscription_type = profile["organization"]["organization_type"]
            .as_str()
            .map(str::to_owned);
        store::save_login(
            root,
            credentials,
            oauth::account_config(&profile)?,
            store::LoginTarget {
                directory: None,
                expected: expected.as_deref(),
            },
        )
    });
    pending.status.authorization_url = None;
    match result {
        Ok(id) => {
            pending.status.status = "complete";
            pending.status.account_id = Some(id.clone());
            Ok(id)
        }
        Err(error) => {
            pending.status.status = "failed";
            pending.status.error = Some(error.to_string());
            Err(error)
        }
    }
}

pub(super) fn cancel(id: &str) -> Result<()> {
    let session = pending(id)?;
    let mut pending = session.lock().map_err(|_| Error::Busy)?;
    if pending.status.status == "complete" {
        return Ok(());
    }
    pending.cancelled = true;
    pending.pkce = None;
    pending.status.status = "cancelled";
    pending.status.authorization_url = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_attempt_cannot_poll_or_exchange_a_code() {
        let status = start(None).unwrap();
        pending(&status.login_id).unwrap().lock().unwrap().started = Instant::now() - TIMEOUT;
        assert!(matches!(poll(&status.login_id), Err(Error::Expired)));
        let root = tempfile::tempdir().unwrap();
        assert!(matches!(
            submit(root.path(), &status.login_id, "mock"),
            Err(Error::Expired)
        ));
    }
}
