use super::{package::Home, Error, Result, View};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

pub(super) struct HomeServer {
    pub base: String,
    pub md5: String,
    pub home: Arc<Home>,
    url: String,
    running: Arc<AtomicBool>,
}

impl Drop for HomeServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
    }
}

impl HomeServer {
    pub fn view(&self) -> View {
        View {
            md5: self.md5.clone(),
            url: self.url.clone(),
        }
    }

    pub fn start(base: String, md5: String, home: Home) -> Result<Self> {
        let server = Arc::new(Server::http("127.0.0.1:0").map_err(|_| Error::Unavailable)?);
        let host = server.server_addr().to_string();
        let url = format!(
            "http://{host}/browser-home/site/{}/index.html",
            home.revision
        );
        let home = Arc::new(home);
        let running = Arc::new(AtomicBool::new(true));
        for _ in 0..2 {
            let (server, host, home, running) =
                (server.clone(), host.clone(), home.clone(), running.clone());
            std::thread::Builder::new()
                .name("browser-home".into())
                .spawn(move || {
                    while running.load(Ordering::Acquire) {
                        match server.recv_timeout(Duration::from_millis(250)) {
                            Ok(Some(request)) => respond(request, Some(&home), Some(&host)),
                            Ok(None) => {}
                            Err(_) => break,
                        }
                    }
                })
                .map_err(|_| Error::Unavailable)?;
        }
        Ok(Self {
            base,
            md5,
            home,
            url,
            running,
        })
    }
}

fn response(
    request: &Request,
    home: Option<&Home>,
    host: Option<&str>,
) -> Option<tiny_http::ResponseBox> {
    if !matches!(request.method(), Method::Get | Method::Head) {
        return None;
    }
    if let Some(host) = host {
        if !request
            .headers()
            .iter()
            .any(|h| h.field.equiv("Host") && h.value.as_str() == host)
        {
            return None;
        }
    }
    let home = home?;
    let url = url::Url::parse(&format!("http://localhost{}", request.url())).ok()?;
    let prefix = format!("/browser-home/site/{}/", home.revision);
    let encoded = url.path().strip_prefix(&prefix)?;
    let name = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let name = if name.is_empty() { "index.html" } else { &name };
    if !super::package::safe_path(name) {
        return None;
    }
    let (mime, bytes) = home.files.get(name).or_else(|| {
        (!name.rsplit('/').next()?.contains('.'))
            .then(|| home.files.get("index.html"))
            .flatten()
    })?;
    let body = if request.method() == &Method::Head {
        Vec::new()
    } else {
        bytes.clone()
    };
    let mut response = Response::from_data(body);
    for (key, value) in [
        ("Content-Type", mime.as_str()),
        (
            "Content-Security-Policy",
            "sandbox allow-scripts; object-src 'none'; frame-src 'none'; form-action 'none'",
        ),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        ("Access-Control-Allow-Origin", "*"),
        ("Cross-Origin-Resource-Policy", "cross-origin"),
    ] {
        response.add_header(Header::from_bytes(key, value).ok()?);
    }
    Some(response.boxed())
}

pub(super) fn respond(request: Request, home: Option<&Home>, host: Option<&str>) {
    let response =
        response(&request, home, host).unwrap_or_else(|| Response::empty(StatusCode(404)).boxed());
    if let Err(error) = request.respond(response) {
        // Closing a tab cancels pending asset requests.
        if !matches!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
        ) {
            eprintln!("browser home response failed: {}", error.kind());
        }
    }
}
