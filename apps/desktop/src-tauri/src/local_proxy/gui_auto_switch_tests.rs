use super::*;
use crate::{
    codex_gui::{auto_switch_settings::GuiAutoSwitchSettings, web::WebEventState},
    models::{ManagerStateFile, UsageWindow},
    storage::write_json_atomic,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use std::fs;
use tauri::test::MockRuntime;

#[path = "gui_auto_switch_auth_tests.rs"]
mod authentication_tests;

const TEST_APP_PREFIX: &str = "com.codex-switch.gui-auto-test.";
const SELECTION_FILE: &str = "codex-gui-account.json";
const SETTINGS_FILE: &str = "codex-gui-auto-switch.json";

struct Fixture {
    app: tauri::App<MockRuntime>,
    root: PathBuf,
    shared_state: Vec<u8>,
}

impl Fixture {
    fn new(mode: GuiAutoSwitchMode) -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier = format!("{TEST_APP_PREFIX}{}", uuid::Uuid::new_v4());
        let app = tauri::test::mock_builder()
            .manage(WebEventState::default())
            .build(context)
            .unwrap();
        let root = app.path().app_data_dir().unwrap();
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(TEST_APP_PREFIX));
        let shared = ManagerStateFile {
            active_account_id: Some("shared-account".into()),
            active_provider_id: Some("shared-provider".into()),
            active_provider_group: Some("shared-group".into()),
            concurrent_account_routing_enabled: true,
            auto_switch_on_quota_exhaustion: true,
            disabled_account_ids: vec!["gui-b".into()],
            ..Default::default()
        };
        write_json_atomic(
            &root.join("state.json"),
            &serde_json::to_value(shared).unwrap(),
        )
        .unwrap();
        write_json_atomic(
            &root.join(SELECTION_FILE),
            &json!({"kind": "account", "id": "gui-a", "revision": 1}),
        )
        .unwrap();
        let shared_state = fs::read(root.join("state.json")).unwrap();
        let fixture = Self {
            app,
            root,
            shared_state,
        };
        fixture.configure(GuiAutoSwitchSettings {
            enabled: true,
            mode,
            ..Default::default()
        });
        fixture
    }

    fn route(&self) -> Route {
        initial(self.app.handle()).unwrap()
    }

    fn select(&self, id: &str) -> SelectionSnapshot {
        let current = account_selection::snapshot(self.app.handle()).unwrap();
        account_selection::compare_and_switch(
            self.app.handle(),
            current.revision,
            &GuiAccountSelection::Account(id.into()),
        )
        .unwrap()
        .unwrap()
    }

    fn configure(&self, settings: GuiAutoSwitchSettings) {
        let previous = settings::snapshot(self.app.handle()).unwrap();
        let snapshot = SettingsSnapshot {
            settings,
            revision: previous.revision + 1,
        };
        write_json_atomic(
            &self.root.join(SETTINGS_FILE),
            &serde_json::to_value(snapshot).unwrap(),
        )
        .unwrap();
    }

    fn commit(
        &self,
        route: Route,
        candidates: &[Candidate],
        session: Option<&str>,
    ) -> Result<Route, AutoSwitchError> {
        commit(
            self.app.handle(),
            route,
            CandidateSelection {
                candidates,
                session,
                fallback: None,
            },
        )
    }

    fn assert_shared_unchanged(&self) {
        assert_eq!(
            fs::read(self.root.join("state.json")).unwrap(),
            self.shared_state
        );
    }

    fn assert_selection(&self, expected: &str) {
        assert_eq!(
            account_selection::read(self.app.handle()).unwrap(),
            account(expected)
        );
    }

    fn managed_account(&self, name: &str, remaining: f64) -> String {
        let claims = json!({
            "email": format!("{name}@example.test"), "sub": name,
            "exp": chrono::Utc::now().timestamp() + 3_600,
            "https://api.openai.com/auth": { "chatgpt_plan_type": "plus", "chatgpt_account_id": name }
        });
        let token = format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap())
        );
        let mut auth = json!({
            "auth_mode": "chatgpt",
            "tokens": { "access_token": token, "id_token": token, "refresh_token": "fixture-refresh" }
        });
        crate::auth::canonicalize_chatgpt_auth(&mut auth).unwrap();
        crate::auth::validate_auth(&auth).unwrap();
        let id = crate::auth::account_fields(&auth).unwrap().3;
        let directory = self.root.join("accounts").join(&id);
        write_json_atomic(&directory.join("auth.json"), &auth).unwrap();
        let usage = UsageSummary {
            primary: Some(UsageWindow {
                used_percent: 100.0 - remaining,
                remaining_percent: remaining,
                resets_at: None,
                window_minutes: None,
            }),
            fetched_at: Some(chrono::Utc::now().to_rfc3339()),
            ..Default::default()
        };
        crate::storage::save_usage(&directory.join("usage.json"), &usage).unwrap();
        id
    }

    fn disable_in_shared(&mut self, id: &str) {
        let path = self.root.join("state.json");
        let mut shared: ManagerStateFile = serde_json::from_slice(&self.shared_state).unwrap();
        shared.disabled_account_ids.push(id.into());
        write_json_atomic(&path, &serde_json::to_value(shared).unwrap()).unwrap();
        self.shared_state = fs::read(path).unwrap();
    }

    fn add_backup(&self) {
        let provider: Value = json!({
            "id": "gui-backup", "name": "GUI backup", "baseUrl": "https://gui-backup.example.test/v1",
            "apiKey": "fixture-key", "model": "fixture-model", "apiFormat": "openaiResponses"
        });
        write_json_atomic(&self.root.join("providers/gui-backup.json"), &provider).unwrap();
        let mut settings = self.route().config.settings;
        settings.fallback_provider_id = Some("gui-backup".into());
        self.configure(settings);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(states) = ROUTING.get() {
            if let Ok(mut states) = states.lock() {
                states.remove(&self.root);
            }
        }
        // This uniquely named mock application owns the complete directory being removed.
        let root = fs::canonicalize(&self.root).unwrap();
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(TEST_APP_PREFIX));
        if let Err(error) = fs::remove_dir_all(root) {
            eprintln!("Could not clean GUI auto-switch test fixture: {error}");
        }
    }
}

fn account(id: &str) -> GuiAccountSelection {
    GuiAccountSelection::Account(id.into())
}

fn candidate(id: &str) -> Candidate {
    Candidate {
        id: id.into(),
        priority: 0,
        remaining: 50.0,
    }
}

#[test]
fn sequential_switch_changes_only_gui_selection_even_when_shared_rule_disables_candidate() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let initial = fixture.route();
    let revision = initial.seed.revision;
    let next = fixture
        .commit(initial, &[candidate("gui-b")], Some("gui-session"))
        .unwrap();

    assert_eq!(next.selection, account("gui-b"));
    assert!(next.seed.revision > revision);
    fixture.assert_selection("gui-b");
    fixture.assert_shared_unchanged();
}

#[test]
fn manual_a_to_b_to_a_switch_rejects_a_stale_automatic_decision() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let stale = fixture.route();
    fixture.select("gui-b");
    let manual = fixture.select("gui-a");
    assert_eq!(manual.selection, stale.selection);
    assert!(manual.revision > stale.seed.revision);

    let result = fixture.commit(stale, &[candidate("gui-c")], None);
    assert!(matches!(result, Err(AutoSwitchError::Changed)));
    assert_eq!(fixture.route().seed.revision, manual.revision);
    fixture.assert_selection("gui-a");
    fixture.assert_shared_unchanged();
}

#[test]
fn settings_resave_or_disable_rejects_automatic_work_from_the_previous_revision() {
    for enabled in [true, false] {
        let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
        let stale = fixture.route();
        let mut settings = stale.config.settings.clone();
        settings.enabled = enabled;
        fixture.configure(settings);

        let result = fixture.commit(stale, &[candidate("gui-b")], None);
        assert!(matches!(result, Err(AutoSwitchError::Changed)));
        fixture.assert_selection("gui-a");
        fixture.assert_shared_unchanged();
    }
}

#[test]
fn concurrent_sessions_use_gui_candidates_and_keep_selection_seed_and_shared_state() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    let route = fixture.route();
    let candidates = [candidate("gui-pool-one"), candidate("gui-pool-two")];
    let first = fixture
        .commit(route.clone(), &candidates, Some("first"))
        .unwrap();
    let second = fixture
        .commit(route.clone(), &candidates, Some("second"))
        .unwrap();
    let reversed = [candidates[1].clone(), candidates[0].clone()];
    let sticky = fixture
        .commit(route.clone(), &reversed, Some("first"))
        .unwrap();

    assert_eq!(first.selection, account("gui-pool-one"));
    assert_eq!(second.selection, account("gui-pool-two"));
    assert_eq!(sticky.selection, first.selection);
    assert_eq!(first.seed.selection, route.seed.selection);
    assert_eq!(second.seed.revision, route.seed.revision);
    assert_eq!(fixture.route().seed.revision, route.seed.revision);
    fixture.assert_selection("gui-a");
    fixture.assert_shared_unchanged();
}

#[test]
fn provider_fallback_updates_only_the_gui_target() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    fixture.add_backup();
    let route = fixture.route();
    let backup = fallback(fixture.app.handle(), &route, true).unwrap();
    let next = commit(
        fixture.app.handle(),
        route,
        CandidateSelection {
            candidates: &[],
            session: Some("gui-session"),
            fallback: backup,
        },
    )
    .unwrap();

    assert_eq!(
        next.selection,
        GuiAccountSelection::Provider("gui-backup".into())
    );
    assert_eq!(
        account_selection::read(fixture.app.handle()).unwrap(),
        next.selection
    );
    fixture.assert_shared_unchanged();
}

#[test]
fn prepare_switches_below_threshold_to_a_gui_account_disabled_by_shared_rules() {
    let mut fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let current = fixture.managed_account("low-account", 5.0);
    let backup = fixture.managed_account("healthy-account", 50.0);
    fixture.select(&current);
    fixture.disable_in_shared(&backup);
    let mut settings = fixture.route().config.settings;
    settings.minimum_remaining_percent = 10.0;
    fixture.configure(settings);
    let catalog = crate::commands::list_accounts_blocking(fixture.app.handle().clone()).unwrap();
    assert!(
        !catalog
            .iter()
            .find(|account| account.id == backup)
            .unwrap()
            .auto_switch_enabled
    );

    let next = prepare(fixture.app.handle(), Some("gui-session")).unwrap();
    assert_eq!(next.selection, account(&backup));
    fixture.assert_selection(&backup);
    fixture.assert_shared_unchanged();
}

#[test]
fn explicit_quota_failure_overrides_cached_positive_usage_without_changing_shared_state() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let current = fixture.managed_account("failed-account", 90.0);
    let backup = fixture.managed_account("healthy-account", 50.0);
    fixture.select(&current);
    let failed = HashSet::from([current.clone()]);
    let next = after_quota(
        fixture.app.handle(),
        &fixture.route(),
        Some("gui-session"),
        &failed,
    )
    .unwrap()
    .unwrap();

    assert_eq!(next.selection, account(&backup));
    assert!(with_routing(fixture.app.handle(), &next, |state| state
        .exhausted
        .contains_key(&current))
    .unwrap());
    fixture.assert_selection(&backup);
    fixture.assert_shared_unchanged();
}

#[test]
fn prepare_falls_back_to_gui_provider_when_managed_accounts_have_no_quota() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
    let current = fixture.managed_account("empty-account", 0.0);
    fixture.managed_account("empty-backup", 0.0);
    fixture.select(&current);
    fixture.add_backup();

    let next = prepare(fixture.app.handle(), Some("gui-session")).unwrap();
    assert_eq!(
        next.selection,
        GuiAccountSelection::Provider("gui-backup".into())
    );
    assert_eq!(
        account_selection::read(fixture.app.handle()).unwrap(),
        next.selection
    );
    fixture.assert_shared_unchanged();
}

#[test]
fn selected_provider_stays_pinned_with_auto_switch_enabled_without_reading_official_accounts() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    fixture.add_backup();
    let initial = fixture.route();
    let provider = GuiAccountSelection::Provider("gui-backup".into());
    account_selection::compare_and_switch(fixture.app.handle(), initial.seed.revision, &provider)
        .unwrap()
        .unwrap();
    // Any accidental attempt to enumerate official accounts now fails immediately.
    write_json_atomic(&fixture.root.join("accounts/broken/auth.json"), &json!({})).unwrap();

    let next = prepare(fixture.app.handle(), Some("gui-session")).unwrap();
    assert_eq!(next.selection, provider);
    assert_eq!(
        account_selection::read(fixture.app.handle()).unwrap(),
        provider
    );
    fixture.assert_shared_unchanged();
}

#[test]
fn quota_failures_do_nothing_when_gui_switching_or_quota_failover_is_disabled() {
    for (enabled, switch_on_quota_exhaustion) in [(false, true), (true, false)] {
        let fixture = Fixture::new(GuiAutoSwitchMode::Sequential);
        let mut settings = fixture.route().config.settings;
        settings.enabled = enabled;
        settings.switch_on_quota_exhaustion = switch_on_quota_exhaustion;
        fixture.configure(settings);
        let route = fixture.route();
        let failed = HashSet::from(["gui-a".to_string()]);

        assert!(
            after_quota(fixture.app.handle(), &route, Some("gui-session"), &failed)
                .unwrap()
                .is_none()
        );
        assert_eq!(fixture.route().seed.revision, route.seed.revision);
        fixture.assert_selection("gui-a");
        fixture.assert_shared_unchanged();
    }
}

#[test]
fn stale_routing_work_cannot_erase_a_newer_conversation_assignment() {
    let fixture = Fixture::new(GuiAutoSwitchMode::Concurrent);
    let stale = fixture.route();
    fixture.select("gui-b");
    let latest = fixture.route();
    let candidates = [candidate("gui-pool-one"), candidate("gui-pool-two")];
    let assigned = with_routing(fixture.app.handle(), &latest, |state| {
        state
            .scheduler
            .assign(Some("protected"), &candidates, Instant::now())
    })
    .unwrap();
    assert_eq!(assigned.as_deref(), Some("gui-pool-one"));

    let stale_mutation = with_routing(fixture.app.handle(), &stale, |state| {
        state.scheduler.invalidate_account("gui-pool-one");
    });
    assert!(matches!(stale_mutation, Err(AutoSwitchError::Changed)));
    let reversed = [candidates[1].clone(), candidates[0].clone()];
    let retained = with_routing(fixture.app.handle(), &latest, |state| {
        state
            .scheduler
            .assign(Some("protected"), &reversed, Instant::now())
    })
    .unwrap();
    assert_eq!(retained, assigned);
    fixture.assert_shared_unchanged();
}

#[path = "gui_auto_switch_race_tests.rs"]
mod races;
