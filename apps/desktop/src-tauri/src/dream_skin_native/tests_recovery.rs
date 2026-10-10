fn active_recovery_session() -> NativeSessionState {
    let mut state = NativeSessionState::default();
    state.begin_launch(Path::new("test/ChatGPT.exe"), RuntimeLaunchReason::Explicit);
    state.session = NativeRuntimeStatus::Active;
    state.port = Some(DEFAULT_CDP_PORT);
    state
}

#[test]
fn sustained_outage_allows_only_one_automatic_recovery() {
    let mut state = active_recovery_session();
    let mut recovery = RendererRecovery::default();
    let install = Path::new("test/ChatGPT.exe");
    let now = Instant::now();
    let mut attempts = 0;
    for second in 0..600 {
        if recovery.outage_ready(&state, install, now + Duration::from_secs(second)) {
            attempts += 1;
            state.recovery_attempted = true;
            state.begin_launch(install, RuntimeLaunchReason::Recovery);
            state.session = NativeRuntimeStatus::Active;
            state.port = Some(DEFAULT_CDP_PORT);
        }
    }
    assert_eq!(attempts, 1);
}

#[test]
fn frequent_wakes_do_not_bypass_grace_and_changed_installations_never_recover() {
    let state = active_recovery_session();
    let mut recovery = RendererRecovery::default();
    let install = Path::new("test/ChatGPT.exe");
    let now = Instant::now();
    for _ in 0..60 {
        assert!(!recovery.outage_ready(&state, install, now));
    }
    assert!(!recovery.outage_ready(&state, install, now + RENDERER_RECOVERY_GRACE / 2));
    let updated = Path::new("updated/ChatGPT.exe");
    assert!(!recovery.outage_ready(&state, updated, now + RENDERER_RECOVERY_GRACE));
    assert!(!recovery.outage_ready(&state, updated, now + RENDERER_RECOVERY_GRACE * 2));
    assert!(recovery.observed.is_none());
    assert!(!recovery.outage_ready(&state, install, now + RENDERER_RECOVERY_GRACE * 3));
    assert!(recovery.outage_ready(&state, install, now + RENDERER_RECOVERY_GRACE * 4));
}

#[test]
fn recovery_requires_the_recorded_installation() {
    let mut state = active_recovery_session();
    let executable = Path::new("test/ChatGPT.exe");
    assert!(state.allows_recovery_for(executable));
    assert!(!state.allows_recovery_for(Path::new("updated/ChatGPT.exe")));
    state.codex_executable = None;
    assert!(!state.allows_recovery_for(executable));
}

#[cfg(target_os = "windows")]
#[test]
fn recovery_accepts_equivalent_windows_installation_paths() {
    let mut state = active_recovery_session();
    state.codex_executable = Some(r"C:\Apps\ChatGPT.exe".to_string());
    assert!(state.allows_recovery_for(Path::new(r"\\?\C:\APPS\chatgpt.exe")));
}

#[test]
fn new_explicit_launch_changes_identity_even_when_the_port_is_reused() {
    let mut state = active_recovery_session();
    let previous = state.clone();
    let install = Path::new("test/ChatGPT.exe");
    let now = Instant::now();
    let mut recovery = RendererRecovery::default();
    assert!(!recovery.outage_ready(&state, install, now));
    state.recovery_attempted = true;
    state.begin_launch(install, RuntimeLaunchReason::Explicit);
    state.session = NativeRuntimeStatus::Active;
    state.port = previous.port;
    assert!(!state.same_launch(&previous));
    assert!(state.allows_recovery());
    assert!(!recovery.outage_ready(&state, install, now + RENDERER_RECOVERY_GRACE));
}

#[test]
fn spent_recovery_survives_serialization_and_monitor_restart() {
    let mut state = active_recovery_session();
    state.recovery_attempted = true;
    let saved = serde_json::to_vec(&state).unwrap();
    let restored: NativeSessionState = serde_json::from_slice(&saved).unwrap();
    let mut recovery = RendererRecovery::default();
    let install = Path::new("test/ChatGPT.exe");
    let now = Instant::now();
    assert!(!recovery.outage_ready(&restored, install, now));
    assert!(!recovery.outage_ready(&restored, install, now + RENDERER_RECOVERY_GRACE));
}

#[test]
fn failed_and_interrupted_launches_clear_the_port_and_preserve_the_executable() {
    for reason in [RuntimeLaunchReason::Explicit, RuntimeLaunchReason::Recovery] {
        let mut state = active_recovery_session();
        let executable = state.codex_executable.clone();
        state.begin_launch(Path::new("test/ChatGPT.exe"), reason);
        state.port = Some(DEFAULT_CDP_PORT);
        state.fail_launch();
        assert_eq!(state.session, NativeRuntimeStatus::Failed);
        assert_eq!(state.port, None);
        assert_eq!(state.codex_executable, executable);
        assert!(!state.allows_recovery());
    }
}

#[test]
fn skin_verification_failure_preserves_a_working_channel_without_another_restart() {
    let mut state = active_recovery_session();
    state.fail_launch();
    assert_eq!(state.session, NativeRuntimeStatus::Active);
    assert_eq!(state.port, Some(DEFAULT_CDP_PORT));
    assert!(!state.allows_recovery());
}

#[test]
fn paused_skin_only_requests_recovery_when_proxy_needs_it() {
    assert!(!renderer_recovery_required(
        skin_verification_required(true, true),
        false
    ));
    assert!(renderer_recovery_required(
        skin_verification_required(true, true),
        true
    ));
    assert!(!renderer_recovery_required(
        skin_verification_required(false, false),
        false
    ));
}

#[test]
fn legacy_sessions_remain_readable_and_new_sessions_do_not_recover() {
    let mut document = serde_json::to_value(active_recovery_session()).unwrap();
    let object = document.as_object_mut().unwrap();
    object.remove("launchId");
    object.remove("recoveryAttempted");
    let state: NativeSessionState = serde_json::from_value(document).unwrap();
    assert!(state.allows_recovery());
    assert!(!NativeSessionState::default().allows_recovery());
}

#[test]
fn successful_probe_or_absent_process_restarts_the_continuous_outage_clock() {
    let state = active_recovery_session();
    let mut recovery = RendererRecovery::default();
    let install = Path::new("test/ChatGPT.exe");
    let now = Instant::now();
    assert!(!recovery.outage_ready(&state, install, now));
    recovery.reset();
    assert!(!recovery.outage_ready(&state, install, now + RENDERER_RECOVERY_GRACE));
}
