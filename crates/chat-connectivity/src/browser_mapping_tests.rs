use super::*;

async fn request(proxy_port: u16, route: &BrowserRoute) -> (TcpStream, u8) {
    let mut browser = TcpStream::connect((Ipv4Addr::LOCALHOST, proxy_port))
        .await
        .unwrap();
    browser.write_all(&[5, 1, 0]).await.unwrap();
    let mut auth = [0; 2];
    browser.read_exact(&mut auth).await.unwrap();
    assert_eq!(auth, [5, 0]);
    browser
        .write_all(&[5, 1, 0, 3, route.domain.len() as u8])
        .await
        .unwrap();
    browser.write_all(route.domain.as_bytes()).await.unwrap();
    browser.write_u16(route.port).await.unwrap();
    let mut reply = [0; 10];
    browser.read_exact(&mut reply).await.unwrap();
    (browser, reply[1])
}

#[tokio::test]
async fn exact_domain_and_port_retain_http_host_until_revoked() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let route = BrowserRoute {
        domain: "mes-dev.test".into(),
        port: listener.local_addr().unwrap().port(),
        target: None,
    };
    let proxy = BrowserMappingProxy::start([route.clone()].into())
        .await
        .unwrap();
    let (mut browser, code) = request(proxy.port(), &route).await;
    assert_eq!(code, 0);
    let (mut service, _) = listener.accept().await.unwrap();
    let raw = format!(
        "GET / HTTP/1.1\r\nHost: mes-dev.test:{}\r\n\r\n",
        route.port
    );
    browser.write_all(raw.as_bytes()).await.unwrap();
    let mut received = vec![0; raw.len()];
    service.read_exact(&mut received).await.unwrap();
    assert_eq!(received, raw.as_bytes());
    for invalid in [
        BrowserRoute {
            domain: "other.test".into(),
            ..route.clone()
        },
        BrowserRoute {
            port: 0,
            ..route.clone()
        },
    ] {
        assert_ne!(request(proxy.port(), &invalid).await.1, 0);
    }
    proxy.configure(BTreeSet::new()).unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), browser.read_u8())
            .await
            .unwrap()
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::UnexpectedEof
    );
    assert_ne!(request(proxy.port(), &route).await.1, 0);
}

#[tokio::test]
async fn changing_a_local_target_revokes_open_streams_and_preserves_the_browser_address() {
    let first = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let second = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let mut route = BrowserRoute {
        domain: "design.localhost".into(),
        port: 18080,
        target: Some(first.local_addr().unwrap()),
    };
    let proxy = BrowserMappingProxy::start([route.clone()].into())
        .await
        .unwrap();
    let (mut old, status) = request(proxy.port(), &route).await;
    assert_eq!(status, 0);
    let _first_connection = first.accept().await.unwrap();
    route.target = Some(second.local_addr().unwrap());
    proxy.configure([route.clone()].into()).unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), old.read_u8())
            .await
            .unwrap()
            .unwrap_err()
            .kind(),
        std::io::ErrorKind::UnexpectedEof
    );
    assert_eq!(request(proxy.port(), &route).await.1, 0);
    let _second_connection = second.accept().await.unwrap();
}
