use super::*;

fn snapshot() -> Value {
    json!({"thread": {"id": "one", "status": {"type": "idle"}},
        "model": "selected-model", "modelProvider": "gui", "serviceTier": "fast",
        "cwd": "/project", "runtimeWorkspaceRoots": ["/project", "/extra"],
        "approvalPolicy": "on-request", "approvalsReviewer": "auto_review",
        "reasoningEffort": "high", "activePermissionProfile": {"id": "custom-profile"},
        "sandbox": {"type": "workspaceWrite", "networkAccess": false}})
}

#[test]
fn reload_retains_model_permissions_and_workspace_without_copying_history() {
    let snapshot = snapshot();
    let params = resume_settings("one", &snapshot).unwrap();
    assert_eq!(params["model"], "selected-model");
    assert_eq!(params["modelProvider"], "gui");
    assert_eq!(params["serviceTier"], "fast");
    assert_eq!(
        params["runtimeWorkspaceRoots"],
        snapshot["runtimeWorkspaceRoots"]
    );
    assert_eq!(params["approvalPolicy"], "on-request");
    assert_eq!(params["approvalsReviewer"], "auto_review");
    assert_eq!(params["permissions"], "custom-profile");
    assert_eq!(params["config"]["model_reasoning_effort"], "high");
    assert_eq!(params["excludeTurns"], true);
    assert!(params.get("sandbox").is_none());
    assert!(params.get("history").is_none());
}

#[test]
fn stopped_threads_can_reload_capacity_after_a_system_error() {
    for status in ["idle", "notLoaded", "systemError"] {
        let mut response = snapshot();
        response["thread"]["status"]["type"] = status.into();
        assert!(idle_snapshot("one", &response).unwrap(), "{status}");
        assert_eq!(
            resume_settings("one", &response).unwrap(),
            resume_settings("one", &snapshot()).unwrap()
        );
    }
}

#[test]
fn active_or_unrecognized_threads_are_never_detached() {
    let mut response = snapshot();
    for flags in [
        json!([]),
        json!(["waitingOnApproval"]),
        json!(["waitingOnUserInput"]),
    ] {
        response["thread"]["status"] = json!({"type": "active", "activeFlags": flags});
        assert!(!idle_snapshot("one", &response).unwrap());
    }
    response["thread"]["status"]["type"] = "unknown".into();
    assert!(idle_snapshot("one", &response).is_err());
    assert!(idle_snapshot("different", &snapshot()).is_err());
    assert!(idle_snapshot("one", &json!({})).is_err());
}

#[test]
fn legacy_policy_is_not_silently_replaced_by_a_wider_mode() {
    let mut response = snapshot();
    response["activePermissionProfile"] = Value::Null;
    assert_eq!(
        resume_settings("one", &response).unwrap()["sandbox"],
        "workspace-write"
    );
    response["sandbox"]["type"] = "externalSandbox".into();
    assert!(resume_settings("one", &response).is_err());
}

#[tokio::test]
async fn each_thread_has_its_own_serialization_guard() {
    let state = ContextCapacity::default();
    let first = state.thread("one").await;
    let same = state.thread("one").await;
    let other = state.thread("two").await;
    let _guard = first.applied.lock().await;
    assert!(same.applied.try_lock().is_err());
    assert!(other.applied.try_lock().is_ok());
}

#[tokio::test]
async fn unloading_requires_reapplying_unchanged_capacity_without_blocking_the_rpc_reader() {
    let state = ContextCapacity::default();
    let first = state.thread("one").await;
    let other = state.thread("two").await;
    let settings = ContextSettings {
        capacity: Some(400_000),
    };
    let mut applied = first.applied.lock().await;
    *applied = settings.clone();
    *other.applied.lock().await = settings.clone();
    assert!(first.is_applied(&applied, &settings));

    for status in ["unsubscribed", "notSubscribed", "notLoaded"] {
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            state.response(
                "thread/unsubscribe",
                &json!({"threadId": "one"}),
                &json!({"status": status}),
            ),
        )
        .await
        .expect("the event reader must not wait for the capacity guard");
        assert!(!first.is_applied(&applied, &settings));
        assert!(other.is_applied(&*other.applied.lock().await, &settings));
        // A model lookup can resume with defaults before the next send. That is not confirmation.
        state
            .response("thread/resume", &json!({"threadId": "one"}), &snapshot())
            .await;
        assert!(!first.is_applied(&applied, &settings));
        first.confirm();
        assert!(first.is_applied(&applied, &settings));
    }
}

#[tokio::test]
async fn unsubscribe_acknowledgement_waits_for_the_target_engine_to_close() {
    let state = ContextCapacity::default();
    let first = state.thread("one").await;
    let _guard = first.applied.lock().await;
    let generation = first.unloads.load(Ordering::Acquire);
    state
        .response(
            "thread/unsubscribe",
            &json!({"threadId": "one"}),
            &json!({"status": "unsubscribed"}),
        )
        .await;
    let mut waiting = Box::pin(first.wait_for_unload(generation));
    assert!(futures_util::poll!(&mut waiting).is_pending());
    state
        .event("thread/closed", &json!({"threadId": "other"}))
        .await;
    assert!(futures_util::poll!(&mut waiting).is_pending());
    state
        .event("thread/closed", &json!({"threadId": "one"}))
        .await;
    tokio::time::timeout(std::time::Duration::from_secs(1), waiting)
        .await
        .unwrap();
}

#[tokio::test]
async fn early_and_stale_close_notifications_do_not_race_the_next_reload() {
    let state = ContextCapacity::default();
    let first = state.thread("one").await;
    let generation = first.unloads.load(Ordering::Acquire);
    state
        .event("thread/closed", &json!({"threadId": "one"}))
        .await;
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        first.wait_for_unload(generation),
    )
    .await
    .unwrap();
    let generation = first.unloads.load(Ordering::Acquire);
    let mut waiting = Box::pin(first.wait_for_unload(generation));
    assert!(futures_util::poll!(&mut waiting).is_pending());
    state
        .event("thread/closed", &json!({"threadId": "one"}))
        .await;
    tokio::time::timeout(std::time::Duration::from_secs(1), waiting)
        .await
        .unwrap();
}

#[tokio::test]
async fn engine_closure_invalidates_capacity_but_normal_turn_completion_does_not() {
    let state = ContextCapacity::default();
    let thread = state.thread("one").await;
    let settings = ContextSettings {
        capacity: Some(1_000_000),
    };
    let mut applied = thread.applied.lock().await;
    *applied = settings.clone();
    for method in [
        "turn/completed",
        "thread/tokenUsage/updated",
        "thread/status/changed",
    ] {
        state
            .event(
                method,
                &json!({"threadId": "one", "status": {"type": "idle"}}),
            )
            .await;
        assert!(thread.is_applied(&applied, &settings));
    }
    for method in [
        "thread/closed",
        "thread/archived",
        "thread/deleted",
        "thread/status/changed",
    ] {
        state
            .event(
                method,
                &json!({"threadId": "one", "status": {"type": "notLoaded"}}),
            )
            .await;
        assert!(!thread.is_applied(&applied, &settings));
        thread.confirm();
    }
    state
        .response(
            "thread/unsubscribe",
            &json!({"threadId": "one"}),
            &json!({"status": "busy"}),
        )
        .await;
    assert!(thread.is_applied(&applied, &settings));
    assert!(!thread.is_applied(&applied, &ContextSettings::default()));
}

#[tokio::test]
#[ignore = "Set CODEX_CONTEXT_TEST_CLI to an installed Codex binary; requires Node and local HTTP only"]
async fn real_cli_context_capacity_survives_system_errors_and_idle_unload() {
    let executable =
        std::env::var_os("CODEX_CONTEXT_TEST_CLI").expect("CODEX_CONTEXT_TEST_CLI is required");
    let state = ContextCapacity::default();
    let thread = state.thread("one").await;
    let mut applied = thread.applied.lock().await;
    let settings = ContextSettings {
        capacity: Some(400_000),
    };
    *applied = settings.clone();
    state
        .response(
            "thread/unsubscribe",
            &json!({"threadId": "one"}),
            &json!({"status": "unsubscribed"}),
        )
        .await;
    state
        .response("thread/resume", &json!({"threadId": "one"}), &snapshot())
        .await;
    let mut failed = snapshot();
    failed["thread"]["status"]["type"] = "systemError".into();
    let mut configurations = json!({
        "reapplyAfterRelease": !thread.is_applied(&applied, &settings),
        "reapplyAfterSystemError": idle_snapshot("one", &failed).unwrap(),
        "unloadConfig": UNLOAD_CONFIG,
    });
    for (name, capacity) in [
        ("large", Some(1_000_000)),
        ("small", Some(400_000)),
        ("default", None),
    ] {
        let mut params = json!({});
        context_settings::apply_capacity(&mut params, &ContextSettings { capacity });
        configurations[name] = params["config"].clone();
    }
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/codex-gui-context-compaction-smoke.mjs");
    let output = std::process::Command::new("node")
        .arg(script)
        .arg(executable)
        .arg(configurations.to_string())
        .output()
        .expect("run idle context lifecycle fixture");
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
}
