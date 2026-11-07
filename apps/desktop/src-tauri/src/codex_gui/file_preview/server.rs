//! A per-preview loopback stream, scoped to the selected file and adjacent web assets.
use super::{content, navigation, range, PreviewError, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    time::Duration,
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const WORKERS: usize = 4;
const RECEIVE_TIMEOUT: Duration = Duration::from_millis(250);
const DOCUMENT_POLICY: &str = "sandbox allow-scripts; default-src 'self' data: blob: http: https:; \
    script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http: https:; \
    style-src 'self' 'unsafe-inline' http: https:; frame-src 'none'; object-src 'none'; form-action 'none'";

pub(super) struct PreviewServer {
    pub url: String,
    active: Arc<AtomicBool>,
    forwarded_host: Arc<RwLock<Option<String>>>,
}

impl Drop for PreviewServer {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

pub(super) struct Scope {
    file: PathBuf,
    root: PathBuf,
    token: String,
    host: String,
    forwarded_host: Arc<RwLock<Option<String>>>,
}

impl Scope {
    pub(super) fn new(path: &Path, token: String, host: String) -> Result<Self> {
        Ok(Self {
            file: path.to_owned(),
            root: path.parent().ok_or(PreviewError::Read)?.to_owned(),
            token,
            host,
            forwarded_host: Arc::new(RwLock::new(None)),
        })
    }
}

impl PreviewServer {
    pub fn forward_host(&self, host: String) -> Result<()> {
        let address: std::net::SocketAddr = host.parse().map_err(|_| PreviewError::Open)?;
        if address.ip() != std::net::Ipv4Addr::LOCALHOST || address.port() == 0 {
            return Err(PreviewError::Open);
        }
        *self
            .forwarded_host
            .write()
            .map_err(|_| PreviewError::Open)? = Some(host);
        Ok(())
    }

    pub fn start(path: &Path) -> Result<Self> {
        let server = Arc::new(Server::http("127.0.0.1:0").map_err(|_| PreviewError::Open)?);
        let host = server.server_addr().to_string();
        let scope = Arc::new(Scope::new(path, uuid::Uuid::new_v4().to_string(), host)?);
        let mut url =
            url::Url::parse(&format!("http://{}/", scope.host)).map_err(|_| PreviewError::Open)?;
        url.path_segments_mut()
            .map_err(|_| PreviewError::Open)?
            .push(&scope.token)
            .push(
                &path
                    .file_name()
                    .ok_or(PreviewError::Read)?
                    .to_string_lossy(),
            );
        let preview = Self {
            url: url.into(),
            active: Arc::new(AtomicBool::new(true)),
            forwarded_host: Arc::clone(&scope.forwarded_host),
        };
        for _ in 0..WORKERS {
            let (server, scope, active) = (
                Arc::clone(&server),
                Arc::clone(&scope),
                Arc::clone(&preview.active),
            );
            std::thread::Builder::new()
                .name("file-preview".into())
                .spawn(move || serve(server, scope, active))
                .map_err(|_| PreviewError::Open)?;
        }
        Ok(preview)
    }
}

fn serve(server: Arc<Server>, scope: Arc<Scope>, active: Arc<AtomicBool>) {
    while active.load(Ordering::Acquire) {
        match server.recv_timeout(RECEIVE_TIMEOUT) {
            Ok(Some(request)) => respond(request, &scope),
            Ok(None) => {}
            Err(_) => break,
        }
    }
}

fn header(name: &str, value: &str) -> Result<Header> {
    Header::from_bytes(name, value).map_err(|_| PreviewError::Read)
}

fn request_header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str())
}

fn resolve(scope: &Scope, target: &str) -> Option<PathBuf> {
    let prefix = format!("/{}/", scope.token);
    let relative = target.strip_prefix(&prefix)?;
    let base = url::Url::from_directory_path(&scope.root).ok()?;
    let path = base.join(relative).ok()?.to_file_path().ok()?;
    // File URLs normalize Windows verbatim prefixes; compare paths in that same representation.
    validate_asset_path(&base.to_file_path().ok()?, &path)?;
    let path = path.canonicalize().ok()?;
    if !path.starts_with(&scope.root) || !path.is_file() {
        return None;
    }
    if path != scope.file && !is_web_asset(&path) {
        return None;
    }
    Some(path)
}

fn validate_asset_path(root: &Path, path: &Path) -> Option<()> {
    let relative = path.strip_prefix(root).ok()?;
    let mut current = root.to_owned();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return None;
        };
        if name.to_string_lossy().contains(':') {
            return None;
        }
        current.push(name);
        // Do not even resolve a link that could contact a network share or leave this directory.
        if current.symlink_metadata().ok()?.file_type().is_symlink() {
            return None;
        }
    }
    Some(())
}

fn is_web_asset(path: &Path) -> bool {
    matches!(
        content::extension(path).as_str(),
        "html"
            | "htm"
            | "xhtml"
            | "css"
            | "js"
            | "mjs"
            | "json"
            | "wasm"
            | "map"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "avif"
            | "svg"
            | "ico"
            | "bmp"
            | "apng"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "eot"
            | "mp4"
            | "webm"
            | "ogv"
            | "mp3"
            | "wav"
            | "ogg"
            | "m4a"
            | "aac"
            | "flac"
            | "opus"
            | "vtt"
    )
}

fn respond(request: Request, scope: &Scope) {
    let response =
        prepare(&request, scope).unwrap_or_else(|_| Response::empty(StatusCode(404)).boxed());
    // Closing a preview or seeking cancels in-flight media responses intentionally.
    if let Err(error) = request.respond(response) {
        if !matches!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
        ) {
            eprintln!("file preview stream ended: {}", error.kind());
        }
    }
}

fn prepare(request: &Request, scope: &Scope) -> Result<tiny_http::ResponseBox> {
    let host = request_header(request, "Host");
    let forwarded = scope
        .forwarded_host
        .read()
        .map_err(|_| PreviewError::Open)?;
    if host != Some(&scope.host)
        && forwarded
            .as_deref()
            .is_none_or(|allowed| host != Some(allowed))
    {
        return Ok(Response::empty(StatusCode(403)).boxed());
    }
    prepare_asset(request, scope)
}

pub(super) fn prepare_asset(request: &Request, scope: &Scope) -> Result<tiny_http::ResponseBox> {
    if !matches!(request.method(), Method::Get | Method::Head) {
        return Ok(Response::empty(StatusCode(403)).boxed());
    }
    let target = request.url().split('?').next().ok_or(PreviewError::Read)?;
    let path = resolve(scope, target).ok_or(PreviewError::Read)?;
    if let Some(response) = navigation::response(request, &path)? {
        return Ok(response);
    }
    stream(request, &path)
}

fn stream(request: &Request, path: &Path) -> Result<tiny_http::ResponseBox> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let range = request_header(request, "Range");
    let selected = match range {
        Some(value) => match range::parse(value, size) {
            Some(value) => value,
            None => {
                return Ok(Response::empty(StatusCode(416))
                    .with_header(header("Content-Range", &format!("bytes */{size}"))?)
                    .boxed())
            }
        },
        None => range::ByteRange {
            start: 0,
            length: size,
        },
    };
    file.seek(SeekFrom::Start(selected.start))?;
    let mut headers = response_headers(path)?;
    if range.is_some() {
        headers.push(header(
            "Content-Range",
            &format!(
                "bytes {}-{}/{size}",
                selected.start,
                selected.start + selected.length - 1
            ),
        )?);
    }
    let length = usize::try_from(selected.length).map_err(|_| PreviewError::Read)?;
    Ok(Response::new(
        StatusCode(if range.is_some() { 206 } else { 200 }),
        headers,
        file.take(selected.length),
        Some(length),
        None,
    )
    .boxed())
}

pub(super) fn response_headers(path: &Path) -> Result<Vec<Header>> {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mime_type = if matches!(content::extension(path).as_str(), "ts" | "mts" | "m2ts") {
        "video/mp2t"
    } else {
        mime.essence_str()
    };
    let content_type = if mime_type.starts_with("text/") || mime_type == "application/javascript" {
        format!("{mime_type}; charset=utf-8")
    } else {
        mime_type.to_owned()
    };
    let mut headers = vec![
        header("Content-Type", &content_type)?,
        header("Accept-Ranges", "bytes")?,
        header("Cache-Control", "no-store")?,
        header("Access-Control-Allow-Origin", "*")?,
        header("X-Content-Type-Options", "nosniff")?,
        header("Referrer-Policy", "no-referrer")?,
        header("Content-Disposition", "inline")?,
    ];
    // XML and alternate HTML extensions can also run scripts when opened directly.
    if mime_type.ends_with("+xml")
        || matches!(mime_type, "text/html" | "text/xml" | "application/xml")
    {
        headers.push(header("Content-Security-Policy", DOCUMENT_POLICY)?);
    }
    Ok(headers)
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
