fn build_codex_tool_context_from_request(body: &Value) -> CodexToolContext {
    let mut context = CodexToolContext::default();
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        for tool in tools {
            context.add_response_tool(tool);
        }
    }
    if let Some(input) = body.get("input") {
        collect_input_tools(input, &mut context);
    }
    context
}

fn collect_input_tools(value: &Value, context: &mut CodexToolContext) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_input_tools(item, context);
            }
        }
        Value::Object(obj) => {
            if matches!(
                obj.get("type").and_then(Value::as_str),
                Some("tool_search_output" | "additional_tools")
            ) {
                for tool in obj
                    .get("tools")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    context.add_response_tool(tool);
                }
            }
            // Only protocol input items declare tools; tool-result payloads are untrusted data.
        }
        _ => {}
    }
}

fn responses_tool_name(tool: &Value) -> Option<String> {
    tool.get("function")
        .and_then(|function| function.get("name"))
        .or_else(|| tool.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn responses_function_tool_to_chat_tool(tool: &Value, chat_name: &str) -> Option<Value> {
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return None;
    }
    if let Some(function) = tool.get("function") {
        let mut chat_tool = json!({
            "type": "function",
            "function": function.clone()
        });
        if let Some(obj) = chat_tool.get_mut("function").and_then(Value::as_object_mut) {
            obj.insert("name".to_string(), json!(chat_name));
            if let Some(strict) = tool.get("strict").cloned() {
                obj.entry("strict".to_string()).or_insert(strict);
            }
        }
        return Some(chat_tool);
    }

    let mut function = json!({
        "name": chat_name,
        "description": tool.get("description").cloned().unwrap_or_else(|| json!("")),
        "parameters": tool
            .get("parameters")
            .or_else(|| tool.get("input_schema"))
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object" }))
    });
    if let Some(strict) = tool.get("strict") {
        function["strict"] = strict.clone();
    }
    Some(json!({
        "type": "function",
        "function": function
    }))
}

fn responses_custom_tool_description(tool: &Value) -> String {
    let mut description = tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !description.is_empty() {
        description.push_str("\n\n");
    }
    description.push_str(CUSTOM_TOOL_PRESERVED_METADATA_HEADING);
    description.push_str("\n```json\n");
    description.push_str(&canonical_json_string(tool));
    description.push_str("\n```");
    description
}

fn responses_function_call_to_chat_tool_call(
    item: &Value,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
    let namespace = item.get("namespace").and_then(Value::as_str);
    let chat_name = tool_context.chat_name_for_response_function(name, namespace);
    thought_signatures::copy_chat_signature(item, json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": chat_name,
            "arguments": canonicalize_tool_arguments(item.get("arguments"))
        }
    }))
}

fn responses_custom_tool_call_to_chat_tool_call(item: &Value) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = item.get("name").and_then(Value::as_str).unwrap_or("");
    let input = item.get("input").cloned().unwrap_or_else(|| json!(""));
    thought_signatures::copy_chat_signature(item, json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": name,
            "arguments": canonical_json_string(&json!({ CUSTOM_TOOL_INPUT_FIELD: input }))
        }
    }))
}

fn responses_tool_search_call_to_chat_tool_call(item: &Value) -> Value {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("");
    thought_signatures::copy_chat_signature(item, json!({
        "id": call_id,
        "type": "function",
        "function": {
            "name": TOOL_SEARCH_PROXY_NAME,
            "arguments": item
                .get("arguments")
                .map(canonical_json_string)
                .unwrap_or_else(|| "{}".to_string())
        }
    }))
}

fn responses_tool_choice_to_chat(tool_choice: &Value, tool_context: &CodexToolContext) -> Value {
    match tool_choice {
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("function") => {
            let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
            let namespace = obj.get("namespace").and_then(Value::as_str);
            let chat_name = tool_context.chat_name_for_response_function(name, namespace);
            json!({
                "type": "function",
                "function": { "name": chat_name }
            })
        }
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("tool_search") => {
            json!({
                "type": "function",
                "function": { "name": TOOL_SEARCH_PROXY_NAME }
            })
        }
        Value::Object(obj) if obj.get("type").and_then(Value::as_str) == Some("custom") => {
            let name = obj.get("name").and_then(Value::as_str).unwrap_or("");
            json!({
                "type": "function",
                "function": { "name": name }
            })
        }
        _ => tool_choice.clone(),
    }
}

fn chat_to_responses_json(
    chat: &Value,
    tool_context: &CodexToolContext,
    continuation_scope: Option<&chat_bridge_continuation::ContinuationScope>,
) -> Value {
    chat_to_responses_json_with_history(chat, tool_context, continuation_scope, &[])
}

fn chat_to_responses_json_with_history(
    chat: &Value,
    tool_context: &CodexToolContext,
    continuation_scope: Option<&chat_bridge_continuation::ContinuationScope>,
    request_history: &[Value],
) -> Value {
    let id = chat
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(response_id);
    let model = chat
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let mut message = chat
        .pointer("/choices/0/message")
        .cloned()
        .unwrap_or_else(|| json!({}));
    normalize_chat_message_reasoning(&mut message);
    let status = ChatCompletionStatus::from_chat(chat).unwrap_or(ChatCompletionStatus::Completed);
    if let Some(scope) = continuation_scope.filter(|_| status == ChatCompletionStatus::Completed) {
        chat_bridge_continuation::capture_message(scope, &message);
        chat_bridge_continuation::capture_response(scope, &id, &message, request_history);
    }
    let content = message
        .get("content")
        .and_then(value_to_text)
        .unwrap_or_default();
    let mut output = Vec::new();
    if let Some(reasoning) = chat_response_reasoning_item(
        &message,
        &id,
        continuation_scope.filter(|_| status == ChatCompletionStatus::Completed),
    ) {
        output.push(reasoning);
    }
    if !content.is_empty() {
        output.push(json!({
            "id": format!("msg_{}", id),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": content, "annotations": chat_annotations::extract(&message) }]
        }));
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in tool_calls.iter().enumerate() {
            if call
                .pointer("/function/name")
                .and_then(Value::as_str)
                .is_none()
            {
                continue;
            }
            output.push(chat_tool_call_to_response_item(call, index, tool_context));
        }
    }
    let mut response = json!({
        "id": id,
        "object": "response",
        "created_at": unix_now(),
        "status": "completed",
        "model": model,
        "output": output
    });
    if let Some(usage) = chat.get("usage").and_then(chat_usage_to_responses_usage) {
        response["usage"] = usage;
    }
    if let Some(tier) = extract_service_tier_from_value(chat) {
        response["service_tier"] = Value::String(tier);
    }
    status.apply(&mut response);
    response
}

fn chat_usage_to_responses_usage(usage: &Value) -> Option<Value> {
    let usage = token_usage_values_from_usage(usage);
    Some(json!({
        "input_tokens": usage.input_tokens?,
        "input_tokens_details": {
            "cached_tokens": usage.cached_tokens.unwrap_or(0)
        },
        "output_tokens": usage.output_tokens?,
        "output_tokens_details": {
            "reasoning_tokens": usage.reasoning_tokens.unwrap_or(0)
        },
        "total_tokens": usage.total_tokens?
    }))
}

fn chat_tool_call_to_response_item(
    tool_call: &Value,
    index: usize,
    tool_context: &CodexToolContext,
) -> Value {
    let call_id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("call_{index}"));
    let function = tool_call.get("function").unwrap_or(&Value::Null);
    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
    let arguments = canonicalize_tool_arguments(function.get("arguments"));
    let item_id = response_tool_call_item_id_from_chat_name(&call_id, name, tool_context);
    let item = response_tool_call_item_from_chat_name(
        &item_id,
        "completed",
        &call_id,
        name,
        &arguments,
        tool_context,
    );
    thought_signatures::copy_chat_signature(tool_call, item)
}

fn response_tool_call_item_id_from_chat_name(
    call_id: &str,
    chat_name: &str,
    tool_context: &CodexToolContext,
) -> String {
    if tool_context.is_custom_tool_chat_name(chat_name) {
        format!("ctc_{call_id}")
    } else {
        format!("fc_{call_id}")
    }
}

fn response_tool_call_item_from_chat_name(
    item_id: &str,
    status: &str,
    call_id: &str,
    chat_name: &str,
    arguments: &str,
    tool_context: &CodexToolContext,
) -> Value {
    match tool_context.lookup_chat_name(chat_name) {
        Some(spec) if spec.kind == CodexToolKind::ToolSearch => {
            response_tool_search_call_item(call_id, status, arguments)
        }
        Some(spec) if spec.kind == CodexToolKind::Custom => {
            response_custom_tool_call_item(item_id, status, call_id, &spec.name, arguments)
        }
        Some(spec) => response_function_call_item(
            item_id,
            status,
            call_id,
            &spec.name,
            spec.namespace.as_deref(),
            arguments,
        ),
        None => response_function_call_item(item_id, status, call_id, chat_name, None, arguments),
    }
}

fn response_tool_search_call_item(call_id: &str, status: &str, arguments: &str) -> Value {
    json!({
        "type": "tool_search_call",
        "call_id": call_id,
        "status": status,
        "execution": "client",
        "arguments": parse_tool_arguments_object(arguments)
    })
}

fn response_custom_tool_call_item(
    item_id: &str,
    status: &str,
    call_id: &str,
    name: &str,
    arguments: &str,
) -> Value {
    json!({
        "id": item_id,
        "type": "custom_tool_call",
        "status": status,
        "call_id": call_id,
        "name": name,
        "input": custom_tool_input_from_chat_arguments(arguments)
    })
}

fn response_function_call_item(
    item_id: &str,
    status: &str,
    call_id: &str,
    name: &str,
    namespace: Option<&str>,
    arguments: &str,
) -> Value {
    let mut item = json!({
        "id": item_id,
        "type": "function_call",
        "status": status,
        "call_id": call_id,
        "name": name,
        "arguments": arguments
    });
    if let Some(namespace) = namespace.filter(|value| !value.is_empty()) {
        item["namespace"] = json!(namespace);
    }
    item
}

fn parse_tool_arguments_object(arguments: &str) -> Value {
    if arguments.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str::<Value>(arguments)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "query": arguments }))
}

fn custom_tool_input_from_chat_arguments(arguments: &str) -> String {
    if arguments.trim().is_empty() {
        return String::new();
    }
    match serde_json::from_str::<Value>(arguments) {
        Ok(Value::Object(obj)) => obj
            .get(CUSTOM_TOOL_INPUT_FIELD)
            .and_then(Value::as_str)
            .unwrap_or(arguments)
            .to_string(),
        _ => arguments.to_string(),
    }
}

fn canonicalize_tool_arguments(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return "{}".to_string();
    };
    match value {
        Value::String(text) => canonicalize_tool_arguments_str(text),
        other => canonical_json_string(other),
    }
}

fn canonicalize_tool_arguments_str(arguments: &str) -> String {
    let trimmed = arguments.trim();
    if trimmed.is_empty() {
        return "{}".to_string();
    }
    serde_json::from_str::<Value>(trimmed)
        .ok()
        .map(|value| canonical_json_string(&value))
        .unwrap_or_else(|| arguments.to_string())
}

fn canonical_json_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn output_to_chat_tool_content(value: &Value) -> String {
    match value {
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .map(|parsed| canonical_json_string(&parsed))
            .unwrap_or_else(|| text.clone()),
        other => canonical_json_string(other),
    }
}

fn flatten_namespace_tool_name(namespace: &str, name: &str) -> String {
    let full_name = format!("{namespace}__{name}");
    if full_name.len() <= CHAT_TOOL_NAME_MAX_LEN {
        return full_name;
    }

    let mut hasher = Sha256::new();
    hasher.update(full_name.as_bytes());
    let digest = hasher.finalize();
    let hash = digest[..5]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let suffix = format!("__{hash}");
    let prefix_len = CHAT_TOOL_NAME_MAX_LEN.saturating_sub(suffix.len());
    let mut prefix = String::new();
    for ch in full_name.chars() {
        if prefix.len() + ch.len_utf8() > prefix_len {
            break;
        }
        prefix.push(ch);
    }
    format!("{prefix}{suffix}")
}
