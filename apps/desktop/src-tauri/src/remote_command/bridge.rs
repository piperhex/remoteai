//! Authenticated loopback bridge: MCP helpers never receive cloud credentials.
use super::{
    client,
    protocol::{ToolRequest, REQUEST_BYTES},
    state, RemoteError, Result,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

const MAX_REQUESTS: usize = super::protocol::MAX_CONCURRENT_COMMANDS;

#[derive(Deserialize)]
struct Endpoint {
    port: u16,
}

pub(super) fn serve<R: tauri::Runtime>(app: tauri::AppHandle<R>, root: &Path) -> Result<()> {
    state::prepare(root)?;
    super::install::refresh_installed(root)?;
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|_| RemoteError::Connection)?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or(RemoteError::Connection)?
        .port();
    state::write(&root.join("endpoint.json"), &json!({"port":port}))?;
    let active = Arc::new(AtomicUsize::new(0));
    for request in server.incoming_requests() {
        if active.fetch_add(1, Ordering::AcqRel) >= MAX_REQUESTS {
            active.fetch_sub(1, Ordering::AcqRel);
            respond(request, Err(RemoteError::Busy));
            continue;
        }
        let (app, root, active) = (app.clone(), root.to_owned(), active.clone());
        std::thread::spawn(move || {
            handle(app, &root, request);
            active.fetch_sub(1, Ordering::AcqRel);
        });
    }
    Ok(())
}

fn handle<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: &Path,
    mut request: tiny_http::Request,
) {
    let result = authorize(root, &mut request).and_then(|access| {
        client::call(&app, access.operation, || {
            state::authorized(root, &access.id, &access.token)
        })
    });
    respond(request, result);
}

struct Access {
    id: String,
    token: String,
    operation: ToolRequest,
}

fn authorize(root: &Path, request: &mut tiny_http::Request) -> Result<Access> {
    if request.method() != &tiny_http::Method::Post || request.url() != "/" {
        return Err(RemoteError::InvalidRequest);
    }
    let header = |name: &'static str| {
        request
            .headers()
            .iter()
            .find(|header| header.field.equiv(name))
            .map(|header| header.value.as_str().to_owned())
    };
    if header("Origin").is_some() {
        return Err(RemoteError::Disabled);
    }
    let id = header("X-Csw-Home").ok_or(RemoteError::Disabled)?;
    let token = header("Authorization").ok_or(RemoteError::Disabled)?;
    if !state::authorized(root, &id, &token) {
        return Err(RemoteError::Disabled);
    }
    if request
        .body_length()
        .is_none_or(|length| length > REQUEST_BYTES as usize)
    {
        return Err(RemoteError::InvalidRequest);
    }
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take(REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| RemoteError::Connection)?;
    if bytes.len() as u64 > REQUEST_BYTES {
        return Err(RemoteError::InvalidRequest);
    }
    let operation: ToolRequest =
        serde_json::from_slice(&bytes).map_err(|_| RemoteError::InvalidRequest)?;
    Ok(Access {
        id,
        token,
        operation,
    })
}

fn respond(request: tiny_http::Request, result: Result<Value>) {
    let response = match result {
        Ok(value) => json!({"result":value}),
        Err(error) => json!({"error":error.to_string()}),
    };
    if let Err(error) = request.respond(tiny_http::Response::from_string(response.to_string())) {
        eprintln!("remote command helper response: {error}");
    }
}

pub(super) fn call(root: &Path, id: &str, token: &str, request: &ToolRequest) -> Result<Value> {
    if !state::authorized(root, id, token) {
        return Err(RemoteError::Disabled);
    }
    let bytes = std::fs::read(root.join("endpoint.json")).map_err(|_| RemoteError::Connection)?;
    let endpoint: Endpoint = serde_json::from_slice(&bytes).map_err(|_| RemoteError::Connection)?;
    reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| RemoteError::Connection)?
        .post(format!("http://127.0.0.1:{}/", endpoint.port))
        // Each client makes one call. Release the server's keep-alive reader so a burst
        // cannot occupy its read workers while later commands wait for a connection.
        .header(reqwest::header::CONNECTION, "close")
        .header("X-Csw-Home", id)
        .header("Authorization", token)
        .json(request)
        .send()
        .map_err(|_| RemoteError::Connection)?
        .json()
        .map_err(|_| RemoteError::Connection)
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
