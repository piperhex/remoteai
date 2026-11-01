use super::*;

const BYPASS: &str = "skip_thought_signature_validator";

fn signed_call(id: &str, signature: &str) -> Value {
    json!({ "id": id, "type": "function", "function": { "name": "exec_command", "arguments": "{}" },
        "extra_content": { "google": { "thought_signature": signature } } })
}

#[test]
fn gemini_buffered_proofs_survive_without_session_cache() {
    let context = CodexToolContext::default();
    let response = chat_to_responses_json(
        &json!({ "choices": [{ "message": {
        "tool_calls": [signed_call("first", "opaque-proof"), signed_call("second", "")]
    } }] }),
        &context,
        None,
    );
    let input = json!({ "model": "google/gemini-3-pro", "input": response["output"] });
    let mut chat = responses_to_chat_completions(&input);
    super::super::thought_signatures::prepare_chat_history(&mut chat);
    let calls = &chat["messages"][0]["tool_calls"];
    assert_eq!(
        calls[0]["extra_content"]["google"]["thought_signature"],
        "opaque-proof"
    );
    assert!(calls[1].get("extra_content").is_none());
}

#[test]
fn gemini_streamed_proofs_arriving_after_arguments_survive_without_cache() {
    let sse = [
        json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "late", "function": { "name": "exec_command", "arguments": "{}" } }
        ] } }] }),
        json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "extra_content": { "google": { "thought_signature": "late-proof" } } }
        ] }, "finish_reason": "tool_calls" }] }),
    ]
    .iter()
    .map(|chunk| format!("data: {chunk}\n\n"))
    .collect::<String>()
        + "data: [DONE]\n\n";
    let output = chat_sse_to_responses_sse(&sse, "gemini-3-pro");
    let completed = sse_event(&output, "response.completed");
    let done = output
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|data| serde_json::from_str::<Value>(data).ok())
        .find(|event| {
            event["type"] == "response.output_item.done" && event["item"]["type"] == "function_call"
        })
        .unwrap();
    assert_eq!(
        done["item"]["extra_content"]["google"]["thought_signature"],
        "late-proof"
    );
    let chat = responses_to_chat_completions(&json!({ "input": completed["response"]["output"] }));
    assert_eq!(
        chat["messages"][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "late-proof"
    );
}

#[test]
fn gemini_custom_and_search_calls_preserve_supplied_proofs() {
    for kind in ["function_call", "custom_tool_call", "tool_search_call"] {
        let input = json!({ "input": [{ "type": kind, "call_id": "call", "name": "run",
            "arguments": "{}", "input": "patch", "extra_content": {
                "google": { "thought_signature": "supplied-proof" } } }] });
        let chat = responses_to_chat_completions(&input);
        assert_eq!(
            chat["messages"][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            "supplied-proof",
            "{kind}"
        );
    }
}

#[test]
fn gemini_history_fallback_repairs_first_call_only_and_preserves_metadata() {
    for missing in [Value::Null, json!(""), json!(false)] {
        let mut first = signed_call("first", "");
        first["extra_content"]["google"]["thought_signature"] = missing;
        first["extra_content"]["other"] = json!({ "keep": true });
        let mut body = json!({ "model": "google/gemini-3-pro", "messages": [
            { "role": "assistant", "tool_calls": [first, signed_call("parallel", "")] },
            { "role": "tool", "tool_call_id": "first", "content": "ok" },
            { "role": "assistant", "tool_calls": [signed_call("sequential", "real-proof")] }
        ] });
        super::super::thought_signatures::prepare_chat_history(&mut body);
        let messages = &body["messages"];
        assert_eq!(
            messages[0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            BYPASS
        );
        assert_eq!(
            messages[0]["tool_calls"][0]["extra_content"]["other"]["keep"],
            true
        );
        assert_eq!(
            messages[0]["tool_calls"][1]["extra_content"]["google"]["thought_signature"],
            ""
        );
        assert_eq!(
            messages[2]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            "real-proof"
        );
    }
}

#[test]
fn gemini_fallback_does_not_change_other_model_requests() {
    for model in [
        "gpt-5",
        "deepseek-chat",
        "claude-sonnet",
        "not-gemini-3",
        "",
    ] {
        let mut body = json!({ "model": model, "messages": [
            { "role": "assistant", "tool_calls": [signed_call("call", "")] }
        ] });
        let original = body.clone();
        super::super::thought_signatures::prepare_chat_history(&mut body);
        assert_eq!(body, original);
    }
}

#[test]
fn gemini_history_metadata_repair_handles_malformed_input_without_panicking() {
    let mut body = json!({ "model": "gemini-3-pro", "messages": [
        { "role": "assistant", "tool_calls": [7] },
        { "role": "assistant", "tool_calls": [{ "extra_content": false }] },
        { "role": "assistant", "tool_calls": [{ "extra_content": { "google": false } }] }
    ] });
    super::super::thought_signatures::prepare_chat_history(&mut body);
    assert_eq!(body["messages"][0]["tool_calls"], json!([7]));
    for index in [1, 2] {
        assert_eq!(
            body["messages"][index]["tool_calls"][0]["extra_content"]["google"]
                ["thought_signature"],
            BYPASS
        );
    }
}

#[test]
fn gemini_cached_proof_takes_precedence_over_history_fallback() {
    let scope = chat_bridge_continuation::ContinuationScope::new(
        "gemini",
        &uuid::Uuid::new_v4().to_string(),
    );
    chat_bridge_continuation::capture_message(
        &scope,
        &json!({ "tool_calls": [signed_call("cached", "real")] }),
    );
    let input = json!({ "model": "gemini-3-pro", "input": [
        { "type": "function_call", "call_id": "cached", "name": "run", "arguments": "{}" }
    ] });
    let mut chat = responses_to_chat_completions_with_context(
        &input,
        &CodexToolContext::default(),
        Some(&scope),
    );
    super::super::thought_signatures::prepare_chat_history(&mut chat);
    assert_eq!(
        chat["messages"][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "real"
    );
    chat["messages"][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"] =
        Value::Null;
    chat_bridge_continuation::restore_messages(&scope, chat["messages"].as_array_mut().unwrap());
    assert_eq!(
        chat["messages"][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "real"
    );
}

#[test]
fn gemini_http_resumed_history_without_session_uses_compatibility_signature() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}/v1", server.server_addr()));
    provider.api_format = ProviderApiFormat::OpenaiChat;
    provider.model = "google/gemini-3-pro".into();
    let worker = thread::spawn(move || {
        let mut request = server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
        request
            .respond(
                Response::from_string(
                    json!({ "choices": [{ "finish_reason": "stop",
            "message": { "role": "assistant", "content": "Done" } }] })
                    .to_string(),
                )
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap()),
            )
            .unwrap();
        body
    });
    let body = json!({ "input": [
        { "role": "user", "content": "Continue" },
        { "type": "function_call", "call_id": "old-call", "name": "exec_command", "arguments": "{}" },
        { "type": "function_call_output", "call_id": "old-call", "output": "ok" }
    ] });
    forward_provider_request(
        &Method::Post,
        "/v1/responses",
        &[],
        body.to_string().into_bytes(),
        &provider,
    )
    .unwrap();
    let sent = worker.join().unwrap();
    assert_eq!(
        sent["messages"][1]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        BYPASS
    );
    assert_eq!(sent["messages"][2]["tool_call_id"], "old-call");
}
