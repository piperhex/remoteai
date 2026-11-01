use super::{continuation, BridgeError, Context, GENERATED_CALL_PREFIX};
use crate::local_proxy::request_error::{self, Problem, RequestError, Stage};
use serde_json::{json, Value};

#[derive(Default)]
pub(super) struct State {
    pub(super) parts: Vec<Value>,
    pub(super) calls: Vec<Value>,
    pub(super) usage: Value,
    pub(super) reason: Option<String>,
    grounding: super::grounding::Grounding,
}

impl State {
    pub(super) fn observe(&mut self, value: &Value) -> Result<Value, BridgeError> {
        if value.get("error").is_some() {
            return Err(BridgeError::Detailed(request_error::upstream(
                Stage::Gemini,
                value,
            )));
        }
        if let Some(usage) = value.get("usageMetadata").and_then(Value::as_object) {
            if !self.usage.is_object() {
                self.usage = json!({})
            }
            if let Some(target) = self.usage.as_object_mut() {
                target.extend(usage.clone())
            }
        }
        let candidate = value["candidates"].as_array().and_then(|items| {
            items
                .iter()
                .find(|candidate| candidate["index"].as_u64().unwrap_or(0) == 0)
        });
        let Some(candidate) = candidate else {
            if value["promptFeedback"]["blockReason"].is_string() {
                self.reason = Some("SAFETY".into())
            }
            return Ok(json!({}));
        };
        if let Some(reason) = candidate["finishReason"].as_str() {
            self.reason = Some(reason.into())
        }
        self.grounding.observe(candidate);
        let mut delta = json!({});
        for part in candidate["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
        {
            self.append_part(part, &mut delta)?;
        }
        Ok(delta)
    }

    fn append_part(&mut self, part: &Value, delta: &mut Value) -> Result<(), BridgeError> {
        if part.get("inlineData").is_some() || part.get("fileData").is_some() {
            return Err(BridgeError::UnsupportedContent);
        }
        if let Some(text) = part["text"].as_str() {
            let field = if part["thought"] == true {
                "reasoning_content"
            } else {
                "content"
            };
            let mut merged = delta[field].as_str().unwrap_or_default().to_string();
            merged.push_str(text);
            delta[field] = json!(merged);
        } else if let Some(function) = part.get("functionCall") {
            let mut call = function_call(function, self.calls.len())?;
            if let Some(signature) = part["thoughtSignature"]
                .as_str()
                .filter(|value| !value.is_empty())
            {
                call["extra_content"] = json!({ "google": { "thought_signature": signature } });
            }
            if delta.get("tool_calls").is_none() {
                delta["tool_calls"] = json!([])
            }
            if let Some(calls) = delta["tool_calls"].as_array_mut() {
                calls.push(call.clone());
            }
            self.calls.push(call);
        } else if !part.as_object().is_some_and(|object| {
            object.contains_key("thoughtSignature")
                && object
                    .keys()
                    .all(|key| matches!(key.as_str(), "thoughtSignature" | "thought"))
        }) {
            return Err(BridgeError::UnsupportedContent);
        }
        self.parts.push(part.clone());
        Ok(())
    }

    pub(super) fn finish_reason(&self) -> Result<&'static str, BridgeError> {
        match self
            .reason
            .as_deref()
            .ok_or(BridgeError::Detailed(RequestError::new(
                Stage::Gemini,
                Problem::MissingStopReason,
            )))? {
            "STOP" => Ok(if self.calls.is_empty() {
                "stop"
            } else {
                "tool_calls"
            }),
            "MAX_TOKENS" => Ok("length"),
            "SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" => {
                Ok("content_filter")
            }
            reason => Err(BridgeError::Detailed(request_error::upstream(
                Stage::Gemini,
                &json!({"code":reason}),
            ))),
        }
    }

    pub(super) fn annotations(&self) -> Vec<Value> {
        self.grounding.annotations(&self.parts)
    }

    pub(super) fn capture(&self, scope: Option<&continuation::Scope>) {
        if self.reason.as_deref() != Some("STOP") {
            return;
        }
        let ids = self
            .calls
            .iter()
            .filter_map(|call| call["id"].as_str().map(str::to_string))
            .collect::<Vec<_>>();
        continuation::capture(scope, &self.parts, &ids);
    }
}

fn function_call(function: &Value, index: usize) -> Result<Value, BridgeError> {
    let name = function["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or(BridgeError::InvalidToolCall)?;
    let args = function.get("args").cloned().unwrap_or_else(|| json!({}));
    if !args.is_object() {
        return Err(BridgeError::InvalidToolCall);
    }
    let id = function["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{GENERATED_CALL_PREFIX}{}", uuid::Uuid::new_v4().simple()));
    Ok(json!({ "index": index, "id": id, "type": "function",
        "function": { "name": name, "arguments": args.to_string() } }))
}

pub(super) fn to_chat(value: &Value, context: &Context) -> Result<Value, BridgeError> {
    let mut state = State::default();
    let mut message = state.observe(value)?;
    message["annotations"] = json!(state.annotations());
    let reason = state.finish_reason()?;
    state.capture(context.scope.as_ref());
    Ok(
        json!({ "id": value["responseId"].as_str().map(str::to_string).unwrap_or_else(super::super::response_id),
        "model": context.model, "choices": [{ "index": 0, "message": message, "finish_reason": reason }],
        "usage": usage(&state.usage) }),
    )
}

pub(super) fn usage(value: &Value) -> Value {
    if !value.is_object() {
        return Value::Null;
    }
    let thoughts = value["thoughtsTokenCount"].as_u64().unwrap_or(0);
    let input = value["promptTokenCount"]
        .as_u64()
        .unwrap_or(0)
        .saturating_add(value["toolUsePromptTokenCount"].as_u64().unwrap_or(0));
    let output = value["candidatesTokenCount"]
        .as_u64()
        .unwrap_or(0)
        .saturating_add(thoughts);
    json!({ "prompt_tokens": input, "completion_tokens": output,
        "total_tokens": value["totalTokenCount"].as_u64().unwrap_or_else(|| input.saturating_add(output)),
        "prompt_tokens_details": { "cached_tokens": value["cachedContentTokenCount"].as_u64().unwrap_or(0) },
        "completion_tokens_details": { "reasoning_tokens": thoughts } })
}
