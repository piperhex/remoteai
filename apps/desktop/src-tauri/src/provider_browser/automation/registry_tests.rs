use super::*;

#[test]
fn finish_lookup_distinguishes_closed_tabs_from_another_conversations_tabs() {
    let state = State::default();
    let id = uuid::Uuid::new_v4().to_string();
    assert!(state.find("owner", &id).unwrap().is_none());
    state.tabs.lock().unwrap().insert(
        id.clone(),
        Tab {
            id: id.clone(),
            thread_id: "owner".into(),
            url: "https://example.com".into(),
            title: "Example".into(),
            loading: false,
            icons: Vec::new(),
            request_id: "request".into(),
            initial_url: "https://example.com".into(),
            listener: 0,
            created_at: Instant::now(),
            operation: Arc::new(tokio::sync::Mutex::new(())),
        },
    );
    assert!(state.find("owner", &id).unwrap().is_some());
    assert!(matches!(state.find("other", &id), Err(Error::Missing)));
    assert!(state.find("owner", &id).unwrap().is_some());
    state
        .icons(
            &id,
            "https://example.com",
            vec!["https://example.com/assets/icon.png".into()],
        )
        .unwrap();
    assert_eq!(state.get("owner", &id).unwrap().icons.len(), 1);
    state
        .navigated(&id, "https://other.example.com".into())
        .unwrap();
    assert!(state.get("owner", &id).unwrap().icons.is_empty());
    state
        .icons(
            &id,
            "https://example.com",
            vec!["https://example.com/old.png".into()],
        )
        .unwrap();
    assert!(state.get("owner", &id).unwrap().icons.is_empty());
}
