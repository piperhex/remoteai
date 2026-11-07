use super::*;
use std::fs;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("file-preview-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

#[test]
fn image_navigation_retains_the_document_policy_and_existing_asset_scope() {
    let fixture = Fixture::new();
    let html = "<!doctype html><html><body><a href=\"photo.png\">Photo</a></body></html>";
    let path = fixture.file("index.html", html.as_bytes());
    fixture.file("photo.png", b"image bytes");
    let server = PreviewServer::start(&path).unwrap();
    let client = client();
    assert_eq!(
        client.get(&server.url).send().unwrap().text().unwrap(),
        html
    );
    let mut url = url::Url::parse(&server.url).unwrap();
    let channel = uuid::Uuid::new_v4().to_string();
    url.query_pairs_mut()
        .append_pair("__preview_navigation", &channel);
    let response = client.get(url.as_str()).send().unwrap();
    assert_eq!(response.status(), 200);
    assert!(response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("sandbox allow-scripts"));
    let body = response.text().unwrap();
    assert!(body.starts_with(html));
    assert!(body.contains(&format!("const channel = \"{channel}\"")));
    assert!(body.contains("parent.postMessage"));
    let head = client.head(url.as_str()).send().unwrap();
    assert_eq!(head.headers()["content-length"], body.len().to_string());
    assert!(head.bytes().unwrap().is_empty());
    let image = url.join("photo.png").unwrap();
    assert_eq!(
        client.get(image).send().unwrap().text().unwrap(),
        "image bytes"
    );
    let escaped = url
        .join(&format!("../index.html?__preview_navigation={channel}"))
        .unwrap();
    assert_eq!(client.get(escaped).send().unwrap().status(), 404);
    url.set_query(Some("__preview_navigation=invalid"));
    assert_eq!(client.get(url).send().unwrap().text().unwrap(), html);
}

#[test]
fn remote_preview_allows_only_the_registered_loopback_host_and_keeps_asset_and_range_scope() {
    let fixture = Fixture::new();
    let path = fixture.file("index.html", b"<img src=\"photo.png\">");
    fixture.file("photo.png", b"0123456789");
    let server = PreviewServer::start(&path).unwrap();
    let client = client();
    let forwarded = "127.0.0.1:54321";
    assert_eq!(
        client
            .get(&server.url)
            .header("Host", forwarded)
            .send()
            .unwrap()
            .status(),
        403
    );
    for invalid in [
        "example.com:80",
        "192.168.1.2:80",
        "127.0.0.1:0",
        "127.0.0.1:80/secret",
    ] {
        assert!(server.forward_host(invalid.into()).is_err());
    }
    server.forward_host(forwarded.into()).unwrap();
    assert_eq!(
        client
            .get(&server.url)
            .header("Host", forwarded)
            .send()
            .unwrap()
            .status(),
        200
    );
    let asset = url::Url::parse(&server.url)
        .unwrap()
        .join("photo.png")
        .unwrap();
    let response = client
        .get(asset)
        .header("Host", forwarded)
        .header("Range", "bytes=2-4")
        .send()
        .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.text().unwrap(), "234");
    let escaped = url::Url::parse(&server.url)
        .unwrap()
        .join("../photo.png")
        .unwrap();
    assert_eq!(
        client
            .get(escaped)
            .header("Host", forwarded)
            .send()
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        client
            .get(&server.url)
            .header("Host", "127.0.0.1:54322")
            .send()
            .unwrap()
            .status(),
        403
    );
}

#[test]
fn media_streams_support_full_reads_head_and_seek_without_loading_the_whole_file() {
    let fixture = Fixture::new();
    let path = fixture.file("视频 #1+.mp4", b"0123456789");
    let server = PreviewServer::start(&path).unwrap();
    let client = client();
    let full = client.get(&server.url).send().unwrap();
    assert_eq!(full.status(), 200);
    assert_eq!(full.headers()["content-type"], "video/mp4");
    assert_eq!(full.text().unwrap(), "0123456789");
    let head = client.head(&server.url).send().unwrap();
    assert_eq!(head.headers()["content-length"], "10");
    assert!(head.bytes().unwrap().is_empty());
    for (range, body) in [
        ("bytes=2-5", "2345"),
        ("bytes=7-", "789"),
        ("bytes=-3", "789"),
    ] {
        let response = client
            .get(&server.url)
            .header("Range", range)
            .send()
            .unwrap();
        assert_eq!(response.status(), 206);
        assert_eq!(response.text().unwrap(), body);
    }
    let invalid = client
        .get(&server.url)
        .header("Range", "bytes=10-")
        .send()
        .unwrap();
    assert_eq!(invalid.status(), 416);
    assert_eq!(invalid.headers()["content-range"], "bytes */10");
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_len(20 * 1024 * 1024)
        .unwrap();
    let tail = client
        .get(&server.url)
        .header("Range", "bytes=-16")
        .send()
        .unwrap();
    assert_eq!(tail.bytes().unwrap().len(), 16);
}

#[test]
fn only_the_selected_file_and_contained_web_assets_are_served() {
    let fixture = Fixture::new();
    let path = fixture.file("index.html", b"<h1>Hello</h1>");
    fixture.file("style.css", b"h1 { color: red }");
    fixture.file(".env", b"PRIVATE=hidden");
    let server = PreviewServer::start(&path).unwrap();
    let client = client();
    let page = client.get(&server.url).send().unwrap();
    assert_eq!(page.status(), 200);
    assert_eq!(page.headers()["content-type"], "text/html; charset=utf-8");
    assert!(page.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("sandbox allow-scripts"));
    let base = url::Url::parse(&server.url).unwrap();
    assert_eq!(
        client
            .get(base.join("style.css").unwrap())
            .send()
            .unwrap()
            .status(),
        200
    );
    for relative in [".env", "../index.html", "other.html"] {
        assert_eq!(
            client
                .get(base.join(relative).unwrap())
                .send()
                .unwrap()
                .status(),
            404
        );
    }
    assert_eq!(
        client
            .get(&server.url)
            .header("Host", "evil.example")
            .send()
            .unwrap()
            .status(),
        403
    );
    assert_eq!(client.post(&server.url).send().unwrap().status(), 403);
    let scope = Scope {
        file: path,
        root: fixture.0.clone(),
        token: "test".into(),
        host: String::new(),
        forwarded_host: Arc::new(RwLock::new(None)),
    };
    for path in [
        "/test/%2e%2e/secret.css",
        "/test/%2fetc/passwd",
        "/wrong/index.html",
    ] {
        assert!(resolve(&scope, path).is_none());
    }
}

#[test]
fn detects_documents_media_and_unknown_text_but_keeps_binary_and_large_files_in_the_menu() {
    use content::PreviewKind::*;
    let fixture = Fixture::new();
    for (name, kind) in [
        ("a.HTML", Html),
        ("a.markdown", Markdown),
        ("a.svg", Image),
        ("a.pdf", Pdf),
        ("a.mp4", Video),
        ("a.webm", Video),
        ("a.flac", Audio),
        ("a.ts", Text),
        ("a.mts", Text),
        ("Dockerfile", Text),
        ("a.custom", Text),
        (".env", Text),
    ] {
        let data = content::load(&fixture.file(name, b"hello"))
            .unwrap()
            .unwrap();
        assert_eq!(data.kind, kind, "{name}");
    }
    assert!(content::load(&fixture.file("a.bin", b"\0\x01\x02"))
        .unwrap()
        .is_none());
    let huge = fixture.file("large.log", b"");
    File::options()
        .write(true)
        .open(&huge)
        .unwrap()
        .set_len(2 * 1024 * 1024 + 1)
        .unwrap();
    assert!(content::load(&huge).unwrap().is_none());
    assert!(content::load(&fixture.0).unwrap().is_none());
}

#[test]
fn transport_streams_are_not_confused_with_typescript_sources() {
    let fixture = Fixture::new();
    let mut bytes = vec![0; 400];
    bytes[0] = 0x47;
    bytes[188] = 0x47;
    let data = content::load(&fixture.file("movie.ts", &bytes))
        .unwrap()
        .unwrap();
    assert_eq!(data.kind, content::PreviewKind::Video);
    assert!(data.text.is_none());
}
