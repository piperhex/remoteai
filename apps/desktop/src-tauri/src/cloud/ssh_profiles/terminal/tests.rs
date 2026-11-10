use super::*;
use crate::cloud::credential_tests::Fixture;

async fn fixture_entry(fixture: &Fixture) -> (String, Arc<Terminal>) {
    let app = fixture.app.handle();
    app.manage(Arc::new(Client::default()));
    let registry = registry(app);
    let entry = Arc::new(Terminal {
        thread_id: "owner-thread".into(),
        owner: agent::session(app).unwrap(),
        remote_id: "fixture-remote".into(),
        buffer: Arc::default(),
        password: Zeroizing::new(None),
        input: Mutex::new(()),
        _permit: registry.slots.clone().try_acquire_owned().unwrap(),
    });
    entry.buffer.event(Event::Output {
        data: b"fixture output".to_vec(),
    });
    let id = "fixture-session".to_owned();
    registry
        .entries
        .lock()
        .await
        .insert(id.clone(), entry.clone());
    (id, entry)
}

#[tokio::test]
async fn sessions_are_owned_by_the_conversation_and_expire_on_account_change() {
    let fixture = Fixture::new();
    let (id, _) = fixture_entry(&fixture).await;
    assert!(find(fixture.app.handle(), "other-thread", &id)
        .await
        .is_err());
    assert!(find(fixture.app.handle(), "owner-thread", &id)
        .await
        .is_ok());
    fixture.login("second");
    assert!(matches!(
        find(fixture.app.handle(), "owner-thread", &id).await,
        Err(TerminalError::Profile(ProfileError::Authentication))
    ));
    assert!(registry(fixture.app.handle())
        .entries
        .lock()
        .await
        .is_empty());
}

#[tokio::test]
async fn missing_saved_password_fails_without_sending_input_and_closing_releases_the_slot() {
    let fixture = Fixture::new();
    let (id, entry) = fixture_entry(&fixture).await;
    let request = serde_json::from_value(
        json!({"action":"password", "threadId":"owner-thread", "sessionId":id}),
    )
    .unwrap();
    assert!(matches!(
        agent_ssh_terminal(fixture.app.handle().clone(), request).await,
        Err(TerminalError::Profile(ProfileError::CredentialsUnavailable))
    ));
    let request = serde_json::from_value(
        json!({"action":"close", "threadId":"owner-thread", "sessionId":id}),
    )
    .unwrap();
    assert_eq!(
        agent_ssh_terminal(fixture.app.handle().clone(), request)
            .await
            .unwrap()["closed"],
        true
    );
    assert!(entry.buffer.read(&id, 0, 0).await.unwrap().closed);
    drop(entry);
    assert_eq!(
        registry(fixture.app.handle()).slots.available_permits(),
        MAX_RETAINED_TERMINALS
    );
}
