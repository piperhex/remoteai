use super::*;

#[tokio::test]
async fn stream_open_waits_for_the_same_route_watch_used_by_its_monitor() {
    let (sender, route) = watch::channel(RouteStatus::default());
    let waiting = tokio::spawn(wait_for_direct_route(route));
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    sender.send_replace(RouteStatus {
        direct: true,
        ..Default::default()
    });
    assert!(waiting.await.unwrap());
}

#[tokio::test]
async fn closing_the_route_watch_never_announces_an_open_stream() {
    let (sender, route) = watch::channel(RouteStatus::default());
    drop(sender);
    assert!(!wait_for_direct_route(route).await);
}
