use super::protocol::{approval_response, ApprovalReply, GuiEvent, GuiRequest};
use serde_json::json;

fn request(value: serde_json::Value) -> GuiRequest {
    serde_json::from_value(value).expect("valid test request")
}

#[test]
fn p2p_prompts_and_images_bypass_size_caps_but_keep_input_validation() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut image = vec![0; 21 * 1024 * 1024];
    image[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let url = format!("data:image/png;base64,{}", STANDARD.encode(image));
    for (text, images) in [("x".repeat(300_000), vec![]), (String::new(), vec![url])] {
        for operation in ["send", "steer"] {
            let mut body = json!({"operation": operation, "threadId": "thread-1", "turnId": "turn-1",
                "text": text, "images": images});
            assert!(request(body.clone()).into_rpc().is_err());
            body["transferMode"] = json!("direct");
            assert!(request(body).into_rpc().is_ok());
        }
    }
    assert!(request(
        json!({"operation": "send", "threadId": "thread-1", "transferMode": "direct",
        "text": "", "images": ["data:image/png;base64,invalid"]})
    )
    .into_rpc()
    .is_err());
}

#[test]
fn only_supported_operations_cross_the_boundary() {
    assert!(serde_json::from_value::<GuiRequest>(
        json!({"operation": "execute", "command": "whoami"})
    )
    .is_err());
    assert!(
        request(json!({"operation": "read", "threadId": "../../auth.json"}))
            .into_rpc()
            .is_err()
    );
}

#[test]
fn compaction_is_scoped_to_a_valid_thread() {
    let (method, params) = request(json!({"operation": "compact", "threadId": "thread-1"}))
        .into_rpc()
        .unwrap();
    assert_eq!(method, "thread/compact/start");
    assert_eq!(params, json!({"threadId": "thread-1"}));
    for thread_id in ["", "../invalid", "thread\n1"] {
        assert!(
            request(json!({"operation": "compact", "threadId": thread_id}))
                .into_rpc()
                .is_err()
        );
    }
}

#[test]
fn reads_include_history_and_lists_include_all_providers() {
    let (method, params) = request(json!({"operation": "read", "threadId": "thread-1"}))
        .into_rpc()
        .unwrap();
    assert_eq!(method, "thread/read");
    assert_eq!(params["includeTurns"], true);
    let (_, params) = request(json!({"operation": "list", "archived": true}))
        .into_rpc()
        .unwrap();
    assert_eq!(params["archived"], true);
    assert_eq!(params["modelProviders"], json!([]));
}

#[test]
fn list_page_sizes_are_forwarded_without_an_upper_cap() {
    for (limit, expected) in [
        (0_u64, 1_u64),
        (101, 101),
        (1000, 1000),
        (9_007_199_254_740_991, 9_007_199_254_740_991),
    ] {
        let (method, params) = request(json!({"operation": "list", "archived": false,
            "limit": limit, "cursor": "next-page"}))
        .into_rpc()
        .unwrap();
        assert_eq!(method, "thread/list");
        assert_eq!(params["limit"], expected);
        assert_eq!(params["cursor"], "next-page");
    }
}

#[test]
fn empty_turns_and_invalid_image_paths_are_rejected() {
    for (text, images) in [(" ", json!([])), ("hello", json!(["relative.png"]))] {
        assert!(request(
            json!({"operation": "send", "threadId": "thread-1", "text": text,
            "images": images})
        )
        .into_rpc()
        .is_err());
    }
}

#[test]
fn user_input_stays_in_a_structured_turn() {
    let (_, params) = request(json!({"operation": "send", "threadId": "thread-1",
        "text": "$(do-not-execute)", "images": [], "effort": "high"}))
    .into_rpc()
    .unwrap();
    assert_eq!(params["input"][0]["text"], "$(do-not-execute)");
    assert_eq!(params["effort"], "high");
}

#[test]
fn queued_messages_are_sent_together_in_order() {
    let (method, params) = request(json!({"operation": "sendBatch", "threadId": "thread-1",
        "messages": [{"text": "first", "images": []}, {"text": "second", "images": []}],
        "model": "test-model", "effort": "high"}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "turn/start");
    assert_eq!(params["input"][0]["text"], "first");
    assert_eq!(params["input"][1]["text"], "second");
    assert_eq!(params["model"], "test-model");
    assert_eq!(params["effort"], "high");
    for messages in [
        json!([]),
        json!([{"text": "", "images": []}]),
        json!([{"text": "hello", "images": ["relative.png"]}]),
    ] {
        assert!(
            request(json!({"operation": "sendBatch", "threadId": "thread-1",
            "messages": messages}))
            .into_rpc()
            .is_err()
        );
    }
}

#[test]
fn steering_is_scoped_to_the_expected_turn() {
    let (method, params) = request(json!({"operation": "steer", "threadId": "thread-1",
        "turnId": "turn-1", "text": "new direction", "images": []}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "turn/steer");
    assert_eq!(params["expectedTurnId"], "turn-1");
    assert_eq!(params["input"][0]["text"], "new direction");
    assert!(params.get("model").is_none());
    assert!(request(json!({"operation": "steer", "threadId": "thread-1",
        "turnId": "../invalid", "text": "hello", "images": []}))
    .into_rpc()
    .is_err());
}

#[test]
fn skills_are_listed_for_the_selected_project_and_sent_as_structured_input() {
    let project = std::env::current_dir().unwrap();
    let (method, params) = request(json!({"operation": "skills", "cwd": project}))
        .into_rpc()
        .unwrap();
    assert_eq!(method, "skills/list");
    assert_eq!(params["cwds"], json!([project]));
    assert_eq!(params["forceReload"], true);
    assert!(request(json!({"operation": "skills", "cwd": "relative"}))
        .into_rpc()
        .is_err());
    let root = std::env::temp_dir().join(format!("gui-skill-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("SKILL.md");
    std::fs::write(&path, "---\nname: deploy\ndescription: Test\n---\n").unwrap();
    let (_, params) = request(
        json!({"operation": "send", "threadId": "thread-1", "text": "$deploy",
        "images": [], "skills": [{"name": "deploy", "path": path}]}),
    )
    .into_rpc()
    .unwrap();
    assert_eq!(
        params["input"][1],
        json!({"type": "skill", "name": "deploy", "path": path})
    );
    for invalid in ["relative/SKILL.md", "D:/missing/SKILL.md", "config.toml"] {
        assert!(request(
            json!({"operation": "send", "threadId": "thread-1", "text": "$deploy",
            "images": [], "skills": [{"name": "deploy", "path": invalid}]})
        )
        .into_rpc()
        .is_err());
    }
    assert!(root.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pasted_images_are_sent_inline_even_without_text() {
    let image = concat!(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC",
        "AAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII="
    );
    let (method, params) = request(json!({"operation": "send", "threadId": "thread-1",
        "text": "", "images": [image]}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "turn/start");
    assert_eq!(params["input"][1], json!({"type": "image", "url": image}));
}

#[test]
fn invalid_inline_images_and_excess_attachments_are_rejected() {
    for images in [
        json!(["data:image/svg+xml;base64,PHN2Zz4="]),
        json!(["data:image/png;base64,not base64"]),
        json!(["data:image/png;base64,aGVsbG8="]),
        json!(["data:image/jpeg;base64,iVBORw0KGgo="]),
        json!(["data:image/png;base64,"]),
        json!(["https://example.com/image.png"]),
        json!(vec!["data:image/png;base64,iVBORw0KGgo="; 9]),
    ] {
        assert!(request(json!({"operation": "send", "threadId": "thread-1",
            "text": "", "images": images}))
        .into_rpc()
        .is_err());
    }
}

#[test]
fn approvals_do_not_allow_unoffered_decisions() {
    let event = GuiEvent {
        method: "item/commandExecution/requestApproval".into(),
        params: json!({"availableDecisions": ["decline", "cancel"]}),
        id: Some(json!(12)),
    };
    let reply: ApprovalReply =
        serde_json::from_value(json!({"id": 12, "decision": "accept"})).unwrap();
    assert!(approval_response(&event, reply).is_err());
}

#[test]
fn start_and_resume_align_approvals_with_the_selected_access() {
    let cwd = std::env::current_dir().unwrap();
    for (access, approval, reviewer) in [
        ("read-only", "on-request", "user"),
        ("workspace-write", "on-request", "auto_review"),
        ("danger-full-access", "never", "user"),
    ] {
        for operation in ["start", "resume"] {
            let (_, params) = request(json!({"operation": operation, "threadId": "thread-1",
                "cwd": cwd, "access": access}))
            .into_rpc()
            .unwrap();
            assert_eq!(params["approvalPolicy"], approval);
            assert_eq!(params["approvalsReviewer"], reviewer);
            assert_eq!(params["sandbox"], access);
        }
    }
}

#[test]
fn new_turns_override_cached_permissions_in_both_directions() {
    for (access, approval, reviewer, sandbox) in [
        (
            "danger-full-access",
            "never",
            "user",
            json!({"type": "dangerFullAccess"}),
        ),
        (
            "read-only",
            "on-request",
            "user",
            json!({"type": "readOnly", "networkAccess": false}),
        ),
        (
            "workspace-write",
            "on-request",
            "auto_review",
            json!({"type": "workspaceWrite", "writableRoots": [],
            "networkAccess": false, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false}),
        ),
    ] {
        for operation in ["send", "sendBatch"] {
            let (method, params) = request(json!({"operation": operation, "threadId": "thread-1",
                "text": "continue", "images": [], "messages": [{"text": "queued", "images": []}],
                "access": access}))
            .into_rpc()
            .unwrap();
            assert_eq!(method, "turn/start");
            assert_eq!(params["approvalPolicy"], approval);
            assert_eq!(params["approvalsReviewer"], reviewer);
            assert_eq!(params["sandboxPolicy"], sandbox);
        }
    }
}

#[test]
fn queued_turns_apply_and_validate_the_selected_project_folder() {
    let cwd = std::env::current_dir().unwrap();
    let (method, params) = request(json!({"operation": "sendBatch", "threadId": "thread-1",
        "messages": [{"text": "continue", "images": []}], "cwd": cwd}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "turn/start");
    assert_eq!(params["cwd"], cwd.to_string_lossy().as_ref());
    for invalid in ["../relative", "folder\u{0000}name"] {
        assert!(
            request(json!({"operation": "sendBatch", "threadId": "thread-1",
            "messages": [{"text": "continue", "images": []}], "cwd": invalid}))
            .into_rpc()
            .is_err()
        );
    }
}

#[test]
fn omitted_turn_access_inherits_permissions_and_invalid_access_is_rejected() {
    for operation in ["send", "sendBatch", "steer"] {
        let mut value = json!({"operation": operation, "threadId": "thread-1", "turnId": "turn-1",
            "text": "continue", "images": [], "messages": [{"text": "queued", "images": []}]});
        let (_, params) = request(value.clone()).into_rpc().unwrap();
        assert!(params.get("approvalPolicy").is_none());
        assert!(params.get("approvalsReviewer").is_none());
        assert!(params.get("sandboxPolicy").is_none());
        if operation != "steer" {
            value["access"] = json!("unknown");
            assert!(serde_json::from_value::<GuiRequest>(value).is_err());
        }
    }
}

#[test]
fn resume_restores_automatic_review_with_workspace_sandbox() {
    let (method, params) = request(json!({"operation": "resume", "threadId": "thread-1",
        "access": "workspace-write"}))
    .into_rpc()
    .unwrap();
    assert_eq!(method, "thread/resume");
    assert_eq!(params["approvalPolicy"], "on-request");
    assert_eq!(params["approvalsReviewer"], "auto_review");
    assert_eq!(params["sandbox"], "workspace-write");
}

#[test]
fn gui_home_preserves_history_and_preferences_without_importing_shared_auth() {
    let root = std::env::temp_dir().join(format!("codex-gui-home-test-{}", uuid::Uuid::new_v4()));
    let source = root.join("official");
    let target = root.join("dev.codex.switch/.codex");
    std::fs::create_dir_all(source.join("sessions")).unwrap();
    std::fs::create_dir_all(target.join("sessions")).unwrap();
    std::fs::write(
        source.join("config.toml"),
        "model = 'sample'\nsqlite_home = 'C:/official'\n",
    )
    .unwrap();
    std::fs::write(source.join("auth.json"), "{\"test\":true}").unwrap();
    std::fs::write(source.join("sessions/official.jsonl"), "official").unwrap();
    std::fs::write(source.join("state_5.sqlite"), "official database").unwrap();
    std::fs::write(target.join("sessions/gui.jsonl"), "gui").unwrap();
    let base_url = "http://127.0.0.1:54321/codex-gui/v1";
    super::home::prepare_from(&source, &target, base_url).unwrap();
    assert!(!target.join("auth.json").exists());
    assert!(!target.join("sessions/official.jsonl").exists());
    assert!(!target.join("state_5.sqlite").exists());
    assert_eq!(
        std::fs::read_to_string(target.join("sessions/gui.jsonl")).unwrap(),
        "gui"
    );
    let config = std::fs::read_to_string(target.join("config.toml")).unwrap();
    let document: toml_edit::DocumentMut = config.parse().unwrap();
    assert_eq!(
        document["model_provider"].as_str(),
        Some("codex-switch-gui")
    );
    assert_eq!(
        document["model_providers"]["codex-switch-gui"]["base_url"].as_str(),
        Some(base_url)
    );
    assert_eq!(
        document["model_providers"]["codex-switch-gui"]["requires_openai_auth"].as_bool(),
        Some(false)
    );
    assert_eq!(
        std::path::Path::new(document["sqlite_home"].as_str().unwrap()),
        target.canonicalize().unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(source.join("sessions/official.jsonl")).unwrap(),
        "official"
    );
    std::fs::write(target.join("config.toml"), "model = 'edited-gui-model'\n").unwrap();
    super::home::prepare_from(&target, &target, base_url).unwrap();
    std::fs::remove_file(source.join("auth.json")).unwrap();
    super::home::prepare_from(&source, &target, base_url).unwrap();
    assert!(!target.join("auth.json").exists());
    let updated = std::fs::read_to_string(target.join("config.toml")).unwrap();
    assert!(updated.contains("edited-gui-model"));
    assert!(root.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn resumed_and_forked_threads_cannot_restore_the_shared_provider() {
    for method in ["thread/start", "thread/resume", "thread/fork"] {
        let mut params = json!({"threadId": "existing", "modelProvider": "codex-switch-local"});
        super::home::scope_thread_request(method, &mut params);
        assert_eq!(params["modelProvider"], "codex-switch-gui");
        assert_eq!(params["threadId"], "existing");
    }
    let mut params = json!({"threadId": "existing"});
    super::home::scope_thread_request("thread/read", &mut params);
    assert!(params.get("modelProvider").is_none());
}

#[test]
fn permission_approval_cannot_grant_more_than_the_server_requested() {
    let event = GuiEvent {
        method: "item/permissions/requestApproval".into(),
        params: json!({"permissions": {"network": {"enabled": true}}}),
        id: Some(json!(1)),
    };
    let reply: ApprovalReply = serde_json::from_value(json!({"id": 1, "decision": "accept",
        "permissions": {"fileSystem": {"write": ["C:/"]}}}))
    .unwrap();
    assert_eq!(
        approval_response(&event, reply).unwrap(),
        json!({"permissions": {"network": {"enabled": true}}, "scope": "turn"})
    );
}
