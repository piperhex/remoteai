use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tiny_http::{Header, Response};

pub(super) struct Server {
    pub url: String,
    pub requests: Arc<Mutex<Vec<String>>>,
    pub bodies: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    pub fn local(catalog: Value) -> Self {
        Self::start(Some(catalog))
    }

    pub fn proxy() -> Self {
        Self::start(None)
    }

    fn start(catalog: Option<Value>) -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}", server.server_addr());
        let url = if catalog.is_some() {
            format!("{url}/codex-gui/v1")
        } else {
            url
        };
        let requests = Arc::new(Mutex::new(Vec::new()));
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let worker = {
            let requests = requests.clone();
            let stop = stop.clone();
            let bodies = bodies.clone();
            std::thread::spawn(move || serve(server, catalog, requests, bodies, stop))
        };
        Self {
            url,
            requests,
            bodies,
            stop,
            worker: Some(worker),
        }
    }

    pub fn response_count(&self) -> usize {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|path| path.ends_with("/responses"))
            .count()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.worker.take().unwrap().join().unwrap();
    }
}

fn serve(
    server: tiny_http::Server,
    catalog: Option<Value>,
    requests: Arc<Mutex<Vec<String>>>,
    bodies: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::Acquire) {
        let Some(mut request) = server
            .recv_timeout(std::time::Duration::from_millis(50))
            .unwrap()
        else {
            continue;
        };
        let path = request.url().to_owned();
        requests.lock().unwrap().push(path.clone());
        let mut body = String::new();
        request.as_reader().read_to_string(&mut body).unwrap();
        if path.ends_with("/responses") {
            bodies
                .lock()
                .unwrap()
                .push(serde_json::from_str(&body).unwrap());
        }
        let (status, mime, body) = match &catalog {
            Some(_) if path.ends_with("/responses") => {
                (200, "text/event-stream", response_stream())
            }
            Some(catalog) => (200, "application/json", catalog.to_string()),
            None if path.contains("external.invalid") => {
                (200, "application/json", "{\"models\":[]}".into())
            }
            None => (
                502,
                "text/plain",
                "Loopback was incorrectly sent through the proxy".into(),
            ),
        };
        request
            .respond(
                Response::from_string(body)
                    .with_status_code(status)
                    .with_header(Header::from_bytes("Content-Type", mime).unwrap()),
            )
            .unwrap();
    }
}

fn response_stream() -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let item = json!({"id": format!("message-{id}"), "type": "message", "role": "assistant",
        "status": "completed", "content": [{"type": "output_text", "text": "loopback-ok", "annotations": []}]});
    [
        json!({"type": "response.created", "response": {"id": id, "status": "in_progress"}}),
        json!({"type": "response.output_item.added", "output_index": 0, "item": item}),
        json!({"type": "response.output_text.delta", "item_id": item["id"],
            "output_index": 0, "content_index": 0, "delta": "loopback-ok"}),
        json!({"type": "response.output_item.done", "output_index": 0, "item": item}),
        json!({"type": "response.completed", "response": {"id": id, "status": "completed", "output": [item],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}}}),
    ].iter().map(|event| format!("data: {event}\n\n")).collect()
}
