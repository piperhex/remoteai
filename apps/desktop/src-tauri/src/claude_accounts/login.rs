use super::{cli, store, Error, Result};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    process::{ChildStdin, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use url::Url;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_LOGINS: usize = 4;
const MAX_OUTPUT_BYTES: usize = 32_768;
type Sessions = HashMap<String, Arc<Mutex<Session>>>;
static LOGINS: OnceLock<Mutex<Sessions>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LoginStatus {
    pub login_id: String,
    pub status: &'static str,
    pub authorization_url: Option<String>,
    pub account_id: Option<String>,
    pub error: Option<String>,
}

struct Session {
    status: LoginStatus,
    stdin: Option<ChildStdin>,
    started: Instant,
    cancelled: bool,
}

fn sessions() -> &'static Mutex<Sessions> {
    LOGINS.get_or_init(Default::default)
}

fn session(id: &str) -> Result<Arc<Mutex<Session>>> {
    sessions()
        .lock()
        .map_err(|_| Error::Busy)?
        .get(id)
        .cloned()
        .ok_or(Error::Expired)
}

pub(super) fn start(root: &Path, account_id: Option<String>) -> Result<LoginStatus> {
    let previous = account_id
        .as_deref()
        .map(|id| store::read(root, id))
        .transpose()?;
    let id = account_id.unwrap_or_else(store::new_id);
    if !store::is_claude_id(&id) {
        return Err(Error::Invalid);
    }
    // Reauthorization gets a fresh directory too, leaving running sessions and their refresh tokens intact.
    let directory = root
        .join("claude-profiles")
        .join(uuid::Uuid::new_v4().simple().to_string());
    std::fs::create_dir_all(&directory).map_err(|_| Error::Storage)?;
    let mut logins = sessions().lock().map_err(|_| Error::Busy)?;
    logins.retain(|_, value| {
        value.lock().is_ok_and(|value| {
            value.started.elapsed() < LOGIN_TIMEOUT
                && !["complete", "failed", "cancelled"].contains(&value.status.status)
        })
    });
    if logins.len() >= MAX_LOGINS {
        return Err(Error::Busy);
    }
    let mut child = cli::command(root, Some(&directory))?
        .args(["auth", "login", "--claudeai"])
        // The CLI prints its own authorization URL; the requesting client opens it on the right computer.
        .env("BROWSER", "echo")
        .env("CI", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| Error::CliRequired)?;
    let login_id = uuid::Uuid::new_v4().simple().to_string();
    let status = LoginStatus {
        login_id: login_id.clone(),
        status: "starting",
        authorization_url: None,
        account_id: None,
        error: None,
    };
    let state = Arc::new(Mutex::new(Session {
        status: status.clone(),
        stdin: child.stdin.take(),
        started: Instant::now(),
        cancelled: false,
    }));
    logins.insert(login_id, state.clone());
    if let Some(stdout) = child.stdout.take() {
        observe_output(stdout, state.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        observe_output(stderr, state.clone());
    }
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let result = await_login(&mut child, &state);
        let result = result.and_then(|()| {
            cli::identity(&root, &directory)?;
            super::native::snapshot(&directory)
        });
        if let Ok(mut session) = state.lock() {
            let result = result.and_then(|(credentials, account)| {
                if session.cancelled || session.started.elapsed() >= LOGIN_TIMEOUT {
                    return Err(Error::Expired);
                }
                store::save_login(
                    &root,
                    credentials,
                    account,
                    store::LoginTarget {
                        directory: Some(directory),
                        expected: previous.as_ref().map(|_| id.as_str()),
                    },
                )
            });
            session.stdin = None;
            session.status.authorization_url = None;
            match result {
                Ok(id) => {
                    session.status.status = "complete";
                    session.status.account_id = Some(id);
                }
                Err(error) => {
                    session.status.status = if session.cancelled {
                        "cancelled"
                    } else {
                        "failed"
                    };
                    session.status.error = Some(error.to_string());
                }
            }
        }
    });
    Ok(status)
}

fn await_login(child: &mut std::process::Child, state: &Mutex<Session>) -> Result<()> {
    loop {
        let stop = state
            .lock()
            .map_err(|_| Error::Busy)
            .map(|state| state.cancelled || state.started.elapsed() >= LOGIN_TIMEOUT)?;
        if stop {
            if child.try_wait().map_err(|_| Error::Login)?.is_none() {
                child.kill().map_err(|_| Error::Login)?;
            }
            child.wait().map_err(|_| Error::Login)?;
            return Err(Error::Expired);
        }
        if let Some(status) = child.try_wait().map_err(|_| Error::Login)? {
            return if status.success() {
                Ok(())
            } else {
                Err(Error::Login)
            };
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Output is bounded and never logged or sent to the frontend. Only a validated authorization URL escapes.
fn observe_output(mut output: impl Read + Send + 'static, state: Arc<Mutex<Session>>) {
    std::thread::spawn(move || {
        let mut text = String::new();
        let mut buffer = [0_u8; 1024];
        while let Ok(size) = output.read(&mut buffer) {
            if size == 0 {
                break;
            }
            if text.len() > MAX_OUTPUT_BYTES {
                text.clear();
            }
            text.push_str(&String::from_utf8_lossy(&buffer[..size]));
            if let Some(url) = authorization_url(&text) {
                if let Ok(mut state) = state.lock() {
                    if !state.cancelled && ["starting", "waiting"].contains(&state.status.status) {
                        state.status.authorization_url = Some(url);
                        state.status.status = "waiting";
                    }
                }
            }
        }
    });
}

pub(super) fn authorization_url(text: &str) -> Option<String> {
    let start = text.find("https://claude.com/cai/oauth/authorize?")?;
    let candidate = text[start..]
        .split(|c: char| c.is_whitespace() || c.is_control())
        .next()?;
    let url = Url::parse(candidate).ok()?;
    let query: HashMap<_, _> = url.query_pairs().collect();
    if query.get("code_challenge_method")?.as_ref() != "S256"
        || query.get("response_type")?.as_ref() != "code"
        || query.get("state")?.is_empty()
        || query.get("code_challenge")?.is_empty()
    {
        return None;
    }
    Some(url.to_string())
}

pub(super) fn poll(id: &str) -> Result<LoginStatus> {
    Ok(session(id)?.lock().map_err(|_| Error::Busy)?.status.clone())
}

pub(super) fn submit(id: &str, input: &str) -> Result<()> {
    let state = session(id)?;
    let mut state = state.lock().map_err(|_| Error::Busy)?;
    if state.cancelled || state.started.elapsed() >= LOGIN_TIMEOUT {
        return Err(Error::Expired);
    }
    let url = state
        .status
        .authorization_url
        .as_deref()
        .ok_or(Error::Busy)?;
    let code = normalize_code(input, url)?;
    let stdin = state.stdin.as_mut().ok_or(Error::Expired)?;
    stdin
        .write_all(format!("{code}\n").as_bytes())
        .map_err(|_| Error::Login)?;
    stdin.flush().map_err(|_| Error::Login)?;
    state.status.status = "verifying";
    Ok(())
}

pub(super) fn normalize_code(input: &str, authorization: &str) -> Result<String> {
    let input = input.trim();
    if input.is_empty() || input.len() > 8192 || input.chars().any(char::is_control) {
        return Err(Error::Invalid);
    }
    let url = Url::parse(authorization).map_err(|_| Error::Invalid)?;
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .ok_or(Error::State)?;
    let (code, supplied_state) = if input.starts_with("https://") {
        let callback = Url::parse(input).map_err(|_| Error::Invalid)?;
        if callback.host_str() != Some("platform.claude.com")
            || callback.path() != "/oauth/code/callback"
            || callback.port_or_known_default() != Some(443)
            || !callback.username().is_empty()
            || callback.password().is_some()
        {
            return Err(Error::Invalid);
        }
        let fields: HashMap<_, _> = callback.query_pairs().collect();
        if fields.contains_key("error") {
            return Err(Error::Login);
        }
        (
            fields.get("code").ok_or(Error::Invalid)?.to_string(),
            Some(fields.get("state").ok_or(Error::State)?.to_string()),
        )
    } else if let Some((code, state)) = input.split_once('#') {
        (code.to_string(), Some(state.to_string()))
    } else {
        (input.to_string(), None)
    };
    if supplied_state.is_some_and(|value| value != state) {
        return Err(Error::State);
    }
    if code.is_empty() || code.chars().any(char::is_whitespace) || code.contains('#') {
        return Err(Error::Invalid);
    }
    // The CLI verifies its own pending OAuth state and PKCE verifier when exchanging this code.
    Ok(format!("{code}#{state}"))
}

pub(super) fn cancel(id: &str) -> Result<()> {
    let state = session(id)?;
    let mut state = state.lock().map_err(|_| Error::Busy)?;
    if state.status.status == "complete" {
        return Ok(());
    }
    state.cancelled = true;
    state.status.status = "cancelled";
    state.stdin = None;
    state.status.authorization_url = None;
    Ok(())
}
