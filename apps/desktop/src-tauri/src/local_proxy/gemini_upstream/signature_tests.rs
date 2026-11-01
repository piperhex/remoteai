use super::{continuation, request, response, tests::context};
use serde_json::{json, Value};

fn input() -> Value {
    json!({ "input": [
        { "role": "user", "content": "Continue" },
        { "type": "function_call", "call_id": "first", "name": "exec_command", "arguments": "{}" },
        { "type": "function_call", "call_id": "parallel", "name": "exec_command", "arguments": "{}" },
        { "type": "function_call_output", "call_id": "first", "output": "ok" },
        { "type": "function_call_output", "call_id": "parallel", "output": "ok" },
        { "type": "function_call", "call_id": "next", "name": "exec_command", "arguments": "{}" }
    ] })
}

#[test]
fn native_gemini_uncached_history_repairs_each_step_without_signing_parallel_calls() {
    let input = input();
    let result = request::convert(&input, &context(&input)).unwrap();
    for step in [1, 3] {
        assert_eq!(
            result["contents"][step]["parts"][0]["thoughtSignature"],
            "skip_thought_signature_validator"
        );
    }
    assert!(result["contents"][1]["parts"][1]
        .get("thoughtSignature")
        .is_none());
}

#[test]
fn native_gemini_preserves_supplied_proof_without_session() {
    let mut input = input();
    input["input"][1]["extra_content"] =
        json!({ "google": { "thought_signature": "supplied-proof" } });
    let result = request::convert(&input, &context(&input)).unwrap();
    assert_eq!(
        result["contents"][1]["parts"][0]["thoughtSignature"],
        "supplied-proof"
    );
}

#[test]
fn native_gemini_roundtrip_keeps_tool_proof_without_cache() {
    let native = json!({ "candidates": [{ "content": { "parts": [
        { "functionCall": { "name": "exec_command", "args": {} }, "thoughtSignature": "native-proof" }
    ] }, "finishReason": "STOP" }] });
    let context = context(&json!({}));
    let chat = response::to_chat(&native, &context).unwrap();
    let result = super::super::chat_to_responses_json(&chat, &context.tools, None);
    let next = request::convert(&json!({ "input": result["output"] }), &context).unwrap();
    assert_eq!(
        next["contents"][0]["parts"][0]["thoughtSignature"],
        "native-proof"
    );
}

#[test]
fn native_gemini_partial_proof_restores_complete_original_parts_without_overwriting_conflicts() {
    let scope = continuation::Scope::fixture(&uuid::Uuid::new_v4().to_string());
    let original = vec![
        json!({ "text": "", "thoughtSignature": "signed-empty" }),
        json!({ "functionCall": { "name": "run", "args": {} }, "thoughtSignature": "original-proof" }),
    ];
    continuation::capture(Some(&scope), &original, &["first".into()]);
    let mut parts = vec![
        json!({ "functionCall": { "id": "first", "name": "run", "args": {} },
        "thoughtSignature": "original-proof" }),
    ];
    let mut conflicting = parts.clone();
    conflicting[0]["thoughtSignature"] = json!("different-proof");
    continuation::restore(Some(&scope), &mut parts);
    assert_eq!(parts, original);
    let before = conflicting.clone();
    continuation::restore(Some(&scope), &mut conflicting);
    assert_eq!(conflicting, before);
}
