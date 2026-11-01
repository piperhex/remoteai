//! Preserve Gemini continuation proofs across protocol conversions and resumed histories.

use serde_json::{json, Value};

// Google's documented escape hatch for imported history that has no original signature.
// https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures#faqs
const IMPORTED_HISTORY_SIGNATURE: &str = "skip_thought_signature_validator";

pub(super) fn chat_signature(call: &Value) -> Option<&str> {
    call.pointer("/extra_content/google/thought_signature")
        .and_then(non_empty_signature)
}

fn non_empty_signature(value: &Value) -> Option<&str> {
    value.as_str().filter(|signature| !signature.is_empty())
}

pub(super) fn copy_chat_signature(source: &Value, mut target: Value) -> Value {
    if let Some(signature) = chat_signature(source) {
        set_chat_signature(&mut target, signature);
    }
    target
}

pub(super) fn set_chat_signature(call: &mut Value, signature: &str) {
    // Retain other provider metadata when repairing an empty signature field.
    for path in ["/extra_content", "/extra_content/google"] {
        if call.pointer(path).is_some_and(|value| !value.is_object()) {
            if let Some(value) = call.pointer_mut(path) {
                *value = json!({});
            }
        }
    }
    call["extra_content"]["google"]["thought_signature"] = json!(signature);
}

/// Apply only after restoring cached history, so real proofs always take precedence.
pub(super) fn prepare_chat_history(body: &mut Value) {
    let model = body["model"].as_str().unwrap_or_default();
    if !model
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with("gemini-")
    {
        return;
    }
    for message in body["messages"].as_array_mut().into_iter().flatten() {
        if message["role"] != "assistant" {
            continue;
        }
        let first = message["tool_calls"]
            .as_array_mut()
            .and_then(|calls| calls.first_mut());
        if let Some(call) = first.filter(|call| call.is_object() && chat_signature(call).is_none())
        {
            set_chat_signature(call, IMPORTED_HISTORY_SIGNATURE);
        }
    }
}

/// Only the first parallel call needs a proof; never move or duplicate real signatures.
pub(super) fn prepare_native_history(contents: &mut [Value]) {
    for content in contents {
        if content["role"] != "model" {
            continue;
        }
        let first = content["parts"].as_array_mut().and_then(|parts| {
            parts
                .iter_mut()
                .find(|part| part.get("functionCall").is_some())
        });
        if let Some(part) =
            first.filter(|part| non_empty_signature(&part["thoughtSignature"]).is_none())
        {
            part["thoughtSignature"] = json!(IMPORTED_HISTORY_SIGNATURE);
        }
    }
}
