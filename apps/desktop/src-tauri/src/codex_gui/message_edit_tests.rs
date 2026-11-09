use super::*;

const PASTED_IMAGE: &str = "data:image/png;base64,iVBORw0KGgo=";

#[test]
fn editing_an_ssh_message_preserves_its_saved_connection_binding() {
    let mut source = history();
    source["turns"][1]["items"][0]["content"] = json!([
        {"type":"text", "text":"original"},
        super::super::ssh_reference::inputs("ssh-profile://development", "开发服务器").unwrap()[0]
    ]);
    super::super::conversation_context::display(&mut source);
    let input = edited_input(&source, &edit()).unwrap();
    assert_eq!(input[0]["text"], "修改后的问题");
    assert!(input[1]["text"]
        .as_str()
        .unwrap()
        .contains("gui_ssh_execute"));
    assert!(input[1]["text"].as_str().unwrap().contains("development"));
}

#[test]
fn editing_a_coze_message_preserves_its_selected_tool_binding() {
    let id = "f321c884-a198-4244-ad4f-53762b3d2aba";
    let mut source = history();
    source["turns"][1]["items"][0]["content"] = json!([
        {"type":"text","text":"original"},
        super::super::coze_reference::inputs(&format!("coze://{id}"), "库存").unwrap()[0]
    ]);
    super::super::conversation_context::display(&mut source);
    let input = edited_input(&source, &edit()).unwrap();
    assert_eq!(input[0]["text"], "修改后的问题");
    assert!(input[1]["text"].as_str().unwrap().contains("coze_call"));
    assert!(input[1]["text"].as_str().unwrap().contains(id));
}

#[tokio::test]
async fn pasted_images_and_selected_skills_are_sent_with_retained_attachments() {
    let directory = std::env::temp_dir().join(format!("edit-skill-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("SKILL.md");
    std::fs::write(&path, "# Test skill").unwrap();
    let mut edit = edit();
    edit.images = vec![PASTED_IMAGE.into()];
    edit.skills = Some(vec![serde_json::from_value(
        json!({ "name": "test", "path": path }),
    )
    .unwrap()]);
    edit.removed_image_indexes = vec![0];
    let (_, params) = send_request(&edit).into_rpc().unwrap();
    let result = replace_message(&edit, params, |method, params| {
        std::future::ready(Ok(match method {
            "thread/resume" | "thread/read" => json!({"thread": history()}),
            "thread/rollback" => json!({"thread": {"id": "thread", "turns": []}}),
            "turn/start" => {
                assert_eq!(
                    params["input"],
                    json!([
                        {"type": "text", "text": edit.text, "text_elements": []},
                        {"type": "image", "url": "https://example.com/image.png"},
                        {"type": "mention", "name": "plugin", "path": "plugin://example"},
                        {"type": "image", "url": PASTED_IMAGE},
                        {"type": "skill", "name": "test", "path": path},
                    ])
                );
                json!({"turn": {"id": "replacement"}})
            }
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await;
    std::fs::remove_dir_all(&directory).unwrap();
    assert!(result.is_ok());
}

#[test]
fn edit_additions_use_normal_image_and_skill_validation() {
    let mut edit = edit();
    for image in [
        "data:image/png;base64,bm90LWltYWdl",
        "relative.png",
        "https://example.com/new.png",
    ] {
        edit.images = vec![image.into()];
        assert!(send_request(&edit).into_rpc().is_err());
    }
    edit.images.clear();
    edit.skills = Some(vec![serde_json::from_value(
        json!({ "name": "test", "path": "relative/SKILL.md" }),
    )
    .unwrap()]);
    assert!(send_request(&edit).into_rpc().is_err());
}

#[tokio::test]
async fn retained_and_pasted_images_share_a_limit_before_rewind() {
    let mut edit = edit();
    edit.images = vec![PASTED_IMAGE.into(); 7];
    let (_, params) = send_request(&edit).into_rpc().unwrap();
    assert!(replace_message(&edit, params, |method, _| {
        assert!(matches!(method, "thread/resume" | "thread/read"));
        std::future::ready(Ok(json!({"thread": history()})))
    })
    .await
    .is_err());
    edit.removed_image_indexes = vec![0];
    assert!(edited_input(&history(), &edit).is_ok());
}

#[test]
fn clearing_skills_only_changes_the_target_message() {
    let mut source = history();
    source["turns"][1]["items"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id": "steering", "type": "userMessage", "content": [
            {"type": "text", "text": "followup"},
            {"type": "skill", "name": "remove", "path": "D:/remove/SKILL.md"}]}));
    let mut edit = edit();
    edit.item_id = "steering".into();
    edit.skills = Some(vec![]);
    let input = edited_input(&source, &edit).unwrap();
    let skills: Vec<_> = input
        .iter()
        .filter(|part| part["type"] == "skill")
        .collect();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0]["name"], "skill");
}

fn edit() -> EditRequest {
    serde_json::from_value(
        json!({"threadId": "thread", "turnId": "last", "itemId": "question",
        "text": "修改后的问题", "access": "read-only"}),
    )
    .unwrap()
}

fn history() -> Value {
    json!({"id": "thread", "status": {"type": "idle"}, "turns": [
        {"id": "first", "status": "completed", "items": [
            {"id": "old", "type": "userMessage", "content": [{"type": "text", "text": "早先的问题"}]}]},
        {"id": "last", "status": "completed", "items": [
            {"id": "question", "type": "userMessage", "content": [
                {"type": "text", "text": "原问题"}, {"type": "text", "text": "更多文字"},
                {"type": "localImage", "path": "D:/photo.png"},
                {"type": "image", "url": "https://example.com/image.png"},
                {"type": "skill", "name": "skill", "path": "D:/SKILL.md"},
                {"type": "mention", "name": "plugin", "path": "plugin://example"}]},
            {"id": "answer", "type": "agentMessage", "text": "旧回复"}]}]})
}

#[test]
fn edit_replaces_all_text_and_preserves_every_attachment() {
    let source = history();
    let input = edited_input(&source, &edit()).unwrap();
    assert_eq!(input.len(), 5);
    assert_eq!(input[0]["text"], "修改后的问题");
    assert_eq!(input[0]["text_elements"], json!([]));
    assert_eq!(
        &input[1..],
        &source["turns"][1]["items"][0]["content"]
            .as_array()
            .unwrap()[2..]
    );
    assert_eq!(
        source["turns"][1]["items"][0]["content"][0]["text"],
        "原问题"
    );
}

#[test]
fn edit_removes_only_selected_images_and_preserves_other_references() {
    let source = history();
    let mut request = edit();
    request.removed_image_indexes = vec![0];
    let input = edited_input(&source, &request).unwrap();
    assert_eq!(input.len(), 4);
    assert_eq!(input[1]["type"], "image");
    assert_eq!(input[2]["type"], "skill");
    assert_eq!(input[3]["type"], "mention");
    request.removed_image_indexes = vec![0, 1];
    assert_eq!(edited_input(&source, &request).unwrap().len(), 3);
    assert_eq!(
        source["turns"][1]["items"][0]["content"]
            .as_array()
            .unwrap()
            .len(),
        6
    );
}

#[test]
fn removing_images_from_a_steering_message_keeps_earlier_images() {
    let mut source = history();
    source["turns"][1]["items"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id": "steering", "type": "userMessage", "content": [
            {"type": "text", "text": "补充"}, {"type": "localImage", "path": "D:/remove.png"}]}));
    let mut request = edit();
    request.item_id = "steering".into();
    request.removed_image_indexes = vec![0];
    let input = edited_input(&source, &request).unwrap();
    assert_eq!(input.len(), 7);
    assert_eq!(input[2]["path"], "D:/photo.png");
    assert_eq!(input[3]["type"], "image");
    assert_eq!(input.last().unwrap()["text"], request.text);
}

#[tokio::test]
async fn invalid_image_removal_is_rejected_before_rewinding() {
    let mut request = edit();
    request.removed_image_indexes = vec![2];
    let result = replace_message(&request, json!({"threadId": "thread"}), |method, _| {
        assert!(matches!(method, "thread/resume" | "thread/read"));
        std::future::ready(Ok(json!({"thread": history()})))
    })
    .await;
    assert!(result.is_err());
}

#[test]
fn edit_rejects_stale_targets_and_running_threads() {
    let mut request = edit();
    request.item_id = "old".into();
    assert!(edited_input(&history(), &request).is_err());
    request = edit();
    request.turn_id = "first".into();
    assert!(edited_input(&history(), &request).is_err());
    let mut source = history();
    source["turns"][1]["status"] = json!("inProgress");
    assert!(edited_input(&source, &edit()).is_err());
    source = history();
    source["status"]["type"] = json!("active");
    assert!(edited_input(&source, &edit()).is_err());
}

#[test]
fn editing_a_steering_message_keeps_earlier_user_inputs() {
    let mut source = history();
    source["turns"][1]["items"]
        .as_array_mut()
        .unwrap()
        .push(json!({
        "id": "steering", "type": "userMessage", "content": [{"type": "text", "text": "补充"}]}));
    let mut request = edit();
    request.item_id = "steering".into();
    let input = edited_input(&source, &request).unwrap();
    assert_eq!(input[0]["text"], "原问题");
    assert_eq!(input.last().unwrap()["text"], "修改后的问题");
    assert!(edited_input(&source, &edit()).is_err());
}

#[test]
fn hidden_continue_instructions_do_not_replace_the_last_editable_message() {
    for status in ["interrupted", "failed"] {
        let mut source = history();
        source["turns"][1]["status"] = json!(status);
        let text = format!(
            "{CONTINUE_MESSAGE}<codex_gui_conversation_context>{}</codex_gui_conversation_context>",
            json!({"kind": "awareness", "running": [], "total": 0})
        );
        source["turns"].as_array_mut().unwrap().push(
            json!({"id": "continuation", "status": "completed",
            "items": [{"id": "continue", "type": "userMessage",
                "content": [{"type": "text", "text": text}]}]}),
        );
        super::super::conversation_context::display(&mut source);
        assert!(edited_input(&source, &edit()).is_ok());
        assert_eq!(rollback_params(&source, &edit()).unwrap()["numTurns"], 2);
    }
}

#[test]
fn rollback_keeps_the_thread_and_removes_only_the_edited_suffix() {
    assert_eq!(
        rollback_params(&history(), &edit()).unwrap(),
        json!({"threadId": "thread", "numTurns": 1})
    );
    let mut source = history();
    source["turns"].as_array_mut().unwrap().remove(0);
    source["turns"][0]["status"] = json!("interrupted");
    source["turns"][0]["items"].as_array_mut().unwrap().pop();
    assert!(edited_input(&source, &edit()).is_ok());
    assert_eq!(rollback_params(&source, &edit()).unwrap()["numTurns"], 1);
    source["turns"] = json!([]);
    assert!(rollback_params(&source, &edit()).is_err());
}

#[tokio::test]
async fn editing_resumes_rolls_back_and_sends_on_the_original_thread() {
    let mut calls = Vec::new();
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, params| {
        calls.push((method, params));
        std::future::ready(Ok(match method {
            "thread/resume" | "thread/read" => json!({"thread": history()}),
            "thread/rollback" => {
                json!({"thread": {"id": "thread", "turns": [history()["turns"][0]]}})
            }
            "turn/start" => json!({"turn": {"id": "replacement"}}),
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await
    .unwrap();
    assert_eq!(
        calls.iter().map(|call| call.0).collect::<Vec<_>>(),
        [
            "thread/resume",
            "thread/read",
            "thread/rollback",
            "turn/start"
        ]
    );
    assert!(calls.iter().all(|call| call.1["threadId"] == "thread"));
    assert_eq!(calls[1].1["includeTurns"], true);
    assert_eq!(calls[2].1["numTurns"], 1);
    assert_eq!(calls[3].1["input"][0]["text"], edit().text);
    assert_eq!(result["thread"]["id"], "thread");
    assert_eq!(result["turn"]["id"], "replacement");
}

#[tokio::test]
async fn failed_resend_returns_rolled_back_history_without_archiving_the_thread() {
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, _| {
        std::future::ready(match method {
            "thread/resume" | "thread/read" => Ok(json!({"thread": history()})),
            "thread/rollback" => Ok(json!({"thread": {"id": "thread", "turns": []}})),
            "turn/start" => Err(GuiError::Timeout),
            _ => panic!("unexpected operation: {method}"),
        })
    })
    .await
    .unwrap();
    assert_eq!(result["thread"]["id"], "thread");
    assert_eq!(result["thread"]["turns"], json!([]));
    assert!(result["error"].is_string());
    assert!(result.get("turn").is_none());
}

#[tokio::test]
async fn paginated_edit_uses_revert_and_keeps_the_retained_history() {
    let mut source = history();
    source["historyMode"] = json!("paginated");
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, params| {
        std::future::ready(Ok(match method {
            "thread/resume" | "thread/read" => json!({"thread": source}),
            "thread/revert" => {
                assert_eq!(
                    params,
                    json!({"threadId": "thread", "beforeTurnId": "last"})
                );
                json!({"thread": {"id": "thread", "turns": []}})
            }
            "turn/start" => json!({"turn": {"id": "replacement"}}),
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await
    .unwrap();
    assert_eq!(result["thread"]["turns"], json!([source["turns"][0]]));
    assert_eq!(result["thread"]["id"], "thread");
}

#[test]
fn edit_requests_validate_text_and_identifiers() {
    for text in [
        "".to_owned(),
        "  \n ".to_owned(),
        "a".repeat(MAX_EDIT_BYTES + 1),
    ] {
        let mut request = edit();
        request.text = text;
        assert!(validate(&request).is_err());
    }
    for field in ["threadId", "turnId", "itemId"] {
        let mut value = json!({"operation": "editMessage", "threadId": "thread", "turnId": "last",
            "itemId": "question", "text": "hello", "access": "read-only"});
        value[field] = json!("../invalid");
        let GuiRequest::EditMessage(request) = serde_json::from_value(value).unwrap() else {
            panic!()
        };
        assert!(validate(&request).is_err());
    }
    assert!(validate(&edit()).is_ok());
}

#[tokio::test]
async fn interrupted_edit_uses_persisted_ids_and_attachments_after_resume() {
    let mut source = history();
    source["historyMode"] = json!("paginated");
    source["turns"][1]["status"] = json!("interrupted");
    let mut resumed = source.clone();
    resumed["turns"][1]["items"][0]["id"] = json!("item-1");
    resumed["turns"][1]["items"][0]["content"] = json!([]);
    let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, params| {
        std::future::ready(Ok(match method {
            "thread/resume" => json!({"thread": resumed}),
            "thread/read" => {
                assert_eq!(params, json!({"threadId": "thread", "includeTurns": true}));
                json!({"thread": source})
            }
            "thread/revert" => {
                assert_eq!(params["beforeTurnId"], "last");
                json!({"thread": {"id": "thread", "turns": []}})
            }
            "turn/start" => {
                assert_eq!(
                    params["input"],
                    json!(edited_input(&source, &edit()).unwrap())
                );
                json!({"turn": {"id": "replacement"}})
            }
            _ => panic!("unexpected operation: {method}"),
        }))
    })
    .await
    .unwrap();
    assert_eq!(result["turn"]["id"], "replacement");
    assert_eq!(result["thread"]["turns"], json!([source["turns"][0]]));
}

#[tokio::test]
async fn edit_does_not_rewind_when_fresh_history_is_stale_active_or_unavailable() {
    let mut stale = history();
    stale["turns"][1]["items"][0]["id"] = json!("newer-message");
    let mut active = history();
    active["status"]["type"] = json!("active");
    for fresh in [Some(stale), Some(active), None] {
        let mut calls = Vec::new();
        let result = replace_message(&edit(), json!({"threadId": "thread"}), |method, _| {
            calls.push(method);
            std::future::ready(match method {
                "thread/resume" => Ok(json!({"thread": history()})),
                "thread/read" => fresh
                    .as_ref()
                    .map(|thread| json!({"thread": thread}))
                    .ok_or(GuiError::Timeout),
                _ => panic!("must not mutate history: {method}"),
            })
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls, ["thread/resume", "thread/read"]);
    }
}
