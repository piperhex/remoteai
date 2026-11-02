use super::*;

#[test]
fn gui_authentication_retry_respects_disabled_settings_and_manual_selection() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let failed = HashSet::from(["gui-a".into()]);
    let route = fixture.route();
    fixture.select("gui-b");
    let next = after_authentication_failure(fixture.app.handle(), &route, None, &failed)
        .unwrap()
        .unwrap();
    assert_eq!(next.selection, account("gui-b"));
    let mut settings = next.config.settings.clone();
    settings.enabled = false;
    fixture.configure(settings);
    assert!(
        after_authentication_failure(fixture.app.handle(), &next, None, &failed)
            .unwrap()
            .is_none()
    );
    fixture.assert_selection("gui-b");
    fixture.assert_shared_unchanged();
}

#[test]
fn gui_authentication_retry_returns_no_target_when_all_accounts_have_failed() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let id = fixture.managed_account("only-account", 50.0);
    fixture.select(&id);
    let route = fixture.route();
    assert!(after_authentication_failure(
        fixture.app.handle(),
        &route,
        None,
        &HashSet::from([id.clone()]),
    )
    .unwrap()
    .is_none());
    fixture.assert_selection(&id);
    fixture.assert_shared_unchanged();
}
