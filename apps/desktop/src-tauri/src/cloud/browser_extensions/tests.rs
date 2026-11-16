use super::*;
use std::{sync::mpsc, thread};
use tiny_http::{Header, Response, Server};

fn archive() -> MarketArchive {
    MarketArchive {
        id: "12345678-1234-4234-8234-123456789abc".into(),
        sha256: "a".repeat(64),
        size: 4,
    }
}

#[test]
fn limits_requests_to_catalog_and_checksum_addressed_archives() {
    let item = archive();
    assert_eq!(
        endpoint("https://market.test/api/", None).unwrap().as_str(),
        "https://market.test/api/browser-extensions"
    );
    assert_eq!(
        endpoint("https://market.test/api/", Some(&item))
            .unwrap()
            .as_str(),
        format!(
            "https://market.test/api/browser-extensions/{}/archive?sha256={}",
            item.id, item.sha256
        )
    );
    for base in [
        "file:///private",
        "https://user:secret@host",
        "https://host?other=1",
        "https://host#other",
    ] {
        assert!(endpoint(base, None).is_err());
    }
    let invalid = [
        MarketArchive {
            id: "../other".into(),
            ..archive()
        },
        MarketArchive {
            sha256: "a&other=1".into(),
            ..archive()
        },
        MarketArchive {
            size: 0,
            ..archive()
        },
        MarketArchive {
            size: MAX_ARCHIVE_BYTES + 1,
            ..archive()
        },
    ];
    for item in invalid {
        assert!(endpoint("https://market.test", Some(&item)).is_err());
    }
}

#[test]
fn preserves_bytes_without_credentials_and_rejects_http_errors_or_redirects() {
    for status in [200, 302, 404, 500] {
        let server = Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}/api", server.server_addr());
        let worker = thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .unwrap();
            assert!(request
                .url()
                .starts_with("/api/browser-extensions/12345678-"));
            assert!(!request
                .headers()
                .iter()
                .any(|header| header.field.equiv("Authorization") || header.field.equiv("Cookie")));
            request
                .respond(
                    Response::from_data([80, 75, 3, 4])
                        .with_status_code(status)
                        .with_header(Header::from_bytes("Location", "/other").unwrap()),
                )
                .unwrap();
        });
        let result = load(&base, Some(&archive()));
        if status == 200 {
            assert_eq!(STANDARD.decode(result.unwrap()).unwrap(), [80, 75, 3, 4]);
        } else {
            assert!(result.is_err());
        }
        worker.join().unwrap();
    }
}

#[test]
fn bounds_bodies_with_and_without_content_length() {
    for chunked in [false, true] {
        let server = Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let worker = thread::spawn(move || {
            let request = server
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .unwrap();
            let length = if chunked { None } else { Some(5) };
            let response = Response::new(
                tiny_http::StatusCode(200),
                vec![],
                std::io::Cursor::new(vec![0; 5]),
                length,
                None,
            );
            request.respond(response).unwrap();
        });
        assert!(load(&base, Some(&archive())).is_err());
        worker.join().unwrap();
    }
}

#[tokio::test(flavor = "current_thread")]
async fn catalog_request_keeps_the_async_caller_responsive() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let (arrived, waiting) = tokio::sync::oneshot::channel();
    let (release, resume) = mpsc::channel();
    let worker = thread::spawn(move || {
        let request = server
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert_eq!(request.url(), "/browser-extensions");
        arrived.send(()).unwrap();
        resume.recv_timeout(Duration::from_secs(3)).unwrap();
        request
            .respond(Response::from_string(r#"{"items":[]}"#))
            .unwrap();
    });
    let pending = tokio::spawn(fetch_browser_extension_market(base, None));
    tokio::time::timeout(Duration::from_secs(3), waiting)
        .await
        .unwrap()
        .unwrap();
    assert!(!pending.is_finished());
    release.send(()).unwrap();
    assert_eq!(
        STANDARD.decode(pending.await.unwrap().unwrap()).unwrap(),
        br#"{"items":[]}"#
    );
    worker.join().unwrap();
    assert_eq!(
        fetch_browser_extension_market("https://user:secret@private.test".into(), None)
            .await
            .unwrap_err(),
        UNAVAILABLE
    );
}
