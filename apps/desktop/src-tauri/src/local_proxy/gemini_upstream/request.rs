use super::{continuation, media, request_options, BridgeError, Context, GENERATED_CALL_PREFIX};
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) fn convert(input: &Value, context: &Context) -> Result<Value, BridgeError> {
    let mut builder = InputBuilder {
        context,
        contents: Vec::new(),
        system: Vec::new(),
        calls: HashMap::new(),
    };
    if let Some(previous) = &context.previous {
        builder.calls = previous.calls.clone();
    }
    if let Some(instructions) = input.get("instructions") {
        builder.system.clear();
        builder.system.extend(media::parts(instructions)?);
    }
    if let Some(items) = input.get("input") {
        builder.append(items)?
    }
    for content in &mut builder.contents {
        if content["role"] == "user" {
            if let Some(parts) = content["parts"].as_array_mut() {
                // Keep parallel tool results together before any following user content.
                parts.sort_by_key(|part| part.get("functionResponse").is_none());
            }
        }
        if content["role"] == "model" {
            if let Some(parts) = content["parts"].as_array_mut() {
                continuation::restore(context.scope.as_ref(), parts);
                remove_synthetic_ids(parts);
            }
        }
    }
    if let Some(previous) = &context.previous {
        builder.contents = super::history::merge_contents(&previous.contents, builder.contents);
        if input.get("instructions").is_none() {
            builder.system = super::history::merge_system(&previous.system, builder.system);
        }
    }
    super::super::thought_signatures::prepare_native_history(&mut builder.contents);
    let mut body = json!({ "contents": builder.contents });
    if !builder.system.is_empty() {
        body["systemInstruction"] = json!({ "parts": builder.system })
    }
    request_options::apply(input, &mut body, context)?;
    Ok(body)
}

struct InputBuilder<'a> {
    context: &'a Context,
    contents: Vec<Value>,
    system: Vec<Value>,
    calls: HashMap<String, String>,
}

impl InputBuilder<'_> {
    fn append(&mut self, item: &Value) -> Result<(), BridgeError> {
        if let Some(items) = item.as_array() {
            for item in items {
                self.append(item)?
            }
            return Ok(());
        }
        match item["type"].as_str() {
            Some("reasoning" | "additional_tools") => {}
            Some("function_call" | "custom_tool_call" | "tool_search_call") => self.call(item)?,
            Some("function_call_output" | "custom_tool_call_output" | "tool_search_output") => {
                self.result(item)?
            }
            Some("agent_message") => {
                let text = super::super::agent_message_text(item)
                    .ok_or(BridgeError::UnsupportedContent)?;
                self.message("user", vec![json!({ "text": text })]);
            }
            _ => self.regular(item)?,
        }
        Ok(())
    }

    fn regular(&mut self, item: &Value) -> Result<(), BridgeError> {
        let role = item["role"].as_str().unwrap_or("user");
        let parts = media::parts(item.get("content").unwrap_or(item))?;
        if matches!(role, "system" | "developer") {
            self.system.extend(parts)
        } else {
            self.message(if role == "assistant" { "model" } else { "user" }, parts)
        }
        Ok(())
    }

    fn call(&mut self, item: &Value) -> Result<(), BridgeError> {
        let call = match item["type"].as_str() {
            Some("custom_tool_call") => {
                super::super::responses_custom_tool_call_to_chat_tool_call(item)
            }
            Some("tool_search_call") => {
                super::super::responses_tool_search_call_to_chat_tool_call(item)
            }
            _ => super::super::responses_function_call_to_chat_tool_call(item, &self.context.tools),
        };
        let id = call["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or(BridgeError::InvalidToolCall)?;
        let name = call["function"]["name"]
            .as_str()
            .filter(|name| !name.is_empty())
            .ok_or(BridgeError::InvalidToolCall)?;
        let args: Value =
            serde_json::from_str(call["function"]["arguments"].as_str().unwrap_or("{}"))
                .map_err(|_| BridgeError::InvalidToolCall)?;
        if !args.is_object() {
            return Err(BridgeError::InvalidToolCall);
        }
        self.calls.insert(id.into(), name.into());
        let mut part = json!({ "functionCall": { "id": id, "name": name, "args": args } });
        if let Some(signature) = super::super::thought_signatures::chat_signature(&call) {
            part["thoughtSignature"] = json!(signature);
        }
        self.message("model", vec![part]);
        Ok(())
    }

    fn result(&mut self, item: &Value) -> Result<(), BridgeError> {
        let id = item["call_id"]
            .as_str()
            .ok_or(BridgeError::InvalidToolCall)?;
        let name = self.calls.get(id).ok_or(BridgeError::InvalidToolCall)?;
        let output = item.get("output").cloned().unwrap_or(Value::Null);
        let mut parts = tool_result(name, &output)?;
        if !id.starts_with(GENERATED_CALL_PREFIX) {
            parts[0]["functionResponse"]["id"] = json!(id)
        }
        self.message("user", parts);
        Ok(())
    }

    fn message(&mut self, role: &str, mut parts: Vec<Value>) {
        if parts.is_empty() {
            return;
        }
        if let Some(content) = self
            .contents
            .last_mut()
            .filter(|content| content["role"] == role)
        {
            if let Some(existing) = content["parts"].as_array_mut() {
                existing.append(&mut parts);
                return;
            }
        }
        self.contents.push(json!({ "role": role, "parts": parts }));
    }
}

fn remove_synthetic_ids(parts: &mut [Value]) {
    for part in parts {
        if part["functionCall"]["id"]
            .as_str()
            .is_some_and(|id| id.starts_with(GENERATED_CALL_PREFIX))
        {
            if let Some(call) = part["functionCall"].as_object_mut() {
                call.remove("id");
            }
        }
    }
}

fn tool_result(name: &str, output: &Value) -> Result<Vec<Value>, BridgeError> {
    let parsed = output
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let value = parsed.as_ref().unwrap_or(output);
    if let Some(blocks) = value.as_array().filter(|blocks| {
        !blocks.is_empty()
            && blocks.iter().all(|b| {
                matches!(
                    b["type"].as_str(),
                    Some(
                        "input_text"
                            | "output_text"
                            | "text"
                            | "input_image"
                            | "image_url"
                            | "input_file"
                            | "file"
                            | "input_audio"
                    )
                )
            })
    }) {
        return media_tool_result(name, blocks);
    }
    let response = if value.is_object() {
        value.clone()
    } else {
        json!({ "output": value })
    };
    Ok(vec![
        json!({ "functionResponse": { "name": name, "response": response } }),
    ])
}

fn media_tool_result(name: &str, blocks: &[Value]) -> Result<Vec<Value>, BridgeError> {
    let mut inline = Vec::new();
    let mut files = Vec::new();
    let mut text = Vec::new();
    for block in media::parts(&json!(blocks))? {
        if let Some(value) = block["text"].as_str() {
            text.push(value.to_string())
        } else if block.get("inlineData").is_some() {
            inline.push(block)
        } else {
            files.push(block)
        }
    }
    let mut response =
        json!({ "functionResponse": { "name": name, "response": { "output": text.join("\n") } } });
    if !inline.is_empty() {
        response["functionResponse"]["parts"] = json!(inline)
    }
    let mut parts = vec![response];
    parts.extend(files);
    Ok(parts)
}
