// Serialize rotating refresh tokens and bound recovery to one reload and one refresh.
use std::sync::{Arc, Weak};

fn account_auth_refresh_lock(path: &Path) -> Result<Arc<Mutex<()>>, String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|error| error.to_string())?;
    locks.retain(|_, lock| lock.strong_count() > 0);
    let lock = locks.get(path).and_then(Weak::upgrade).unwrap_or_default();
    locks.insert(path.to_owned(), Arc::downgrade(&lock));
    Ok(lock)
}

struct AccountAuthRequest<'a> {
    client: &'a Client,
    paths: &'a Paths,
    id: &'a str,
}

impl RequestAuth {
    fn request_with_recovery(
        &mut self,
        context: AccountAuthRequest<'_>,
        mut send: impl FnMut(&Value) -> Result<Response, String>,
    ) -> Result<Response, String> {
        let mut response = send(&self.value)?;
        if response.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(response);
        }
        if self.reload_if_changed(context.paths, context.id)? {
            response = send(&self.value)?;
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.refresh(context.client, context.paths, context.id)?;
            response = send(&self.value)?;
        }
        Ok(response)
    }
}

#[cfg(test)]
mod account_auth_refresh_tests {
    include!("account_auth_refresh_tests.rs");
}
