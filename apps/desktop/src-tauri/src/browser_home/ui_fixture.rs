//! Explicitly invoked by the browser-home Playwright configuration; never starts in ordinary tests.
use super::{package, refresh, server, storage::Cache};
use std::collections::VecDeque;
use tiny_http::{Header, Response, Server};

#[test]
#[ignore]
fn serve_native_home_ui() {
    assert_eq!(std::env::var("BROWSER_HOME_UI_FIXTURE").as_deref(), Ok("1"));
    let directory = tempfile::tempdir().unwrap();
    let cache = Cache::fixture("http://127.0.0.1:1591".into(), directory.path().into());
    let listener = Server::http("127.0.0.1:1593").unwrap();
    let mut pages: VecDeque<server::HomeServer> = VecDeque::new();
    for request in listener.incoming_requests() {
        let route = request.url().to_owned();
        if route.starts_with("/browser-home/site/") {
            let home = pages.iter().find(|page| {
                route.starts_with(&format!("/browser-home/site/{}/", page.home.revision))
            });
            server::respond(request, home.map(|page| page.home.as_ref()), None);
            continue;
        }
        let result = if route == "/check" {
            refresh(&cache)
        } else {
            cache
                .current()
                .map(|value| value.filter(|v| v.enabled).map(|v| v.md5))
        };
        let value = result.and_then(|digest| {
            let Some(digest) = digest else {
                return Ok(None);
            };
            if let Some(page) = pages.iter().find(|p| p.md5 == digest) {
                return Ok(Some(page.view()));
            }
            let home: package::Home = cache.read(&digest)?;
            let page = server::HomeServer::start(cache.base.clone(), digest, home)?;
            let view = page.view();
            pages.push_front(page);
            pages.truncate(2);
            Ok(Some(view))
        });
        let (status, body) = match value {
            Ok(view) => (200, serde_json::to_vec(&view).unwrap()),
            Err(_) => (503, b"null".to_vec()),
        };
        request
            .respond(
                Response::from_data(body)
                    .with_status_code(status)
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
                    .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap()),
            )
            .unwrap();
    }
}
