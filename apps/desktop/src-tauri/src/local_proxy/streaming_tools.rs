impl<R: BufRead> ChatSseReader<R> {
    fn process_tool_call_delta(&mut self, tool_call: &Value) -> String {
        let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let id_delta = tool_call.get("id").and_then(Value::as_str);
        let function = tool_call.get("function").unwrap_or(&Value::Null);
        let name_delta = function.get("name").and_then(Value::as_str);
        let args_delta = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("");
        let signature_delta = tool_call
            .pointer("/extra_content/google/thought_signature")
            .and_then(Value::as_str)
            .unwrap_or("");

        let mut should_add = false;
        let mut output_index = None;
        let mut item_id = String::new();
        let current_name: String;

        {
            let state = self.tools.entry(index).or_default();
            if let Some(id) = id_delta.filter(|value| !value.is_empty()) {
                if !state.added {
                    state.call_id = id.to_string();
                }
            }
            if let Some(name) = name_delta.filter(|value| !value.is_empty()) {
                state.name = name.to_string();
            }
            if !args_delta.is_empty() {
                state.arguments.push_str(args_delta);
            }
            if !signature_delta.is_empty() {
                state.thought_signature.push_str(signature_delta);
            }
            if !state.added && !state.name.is_empty() {
                should_add = true;
            } else if state.added {
                output_index = state.output_index;
                item_id = state.item_id.clone();
            }
            current_name = state.name.clone();
        }

        let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&current_name);
        let mut output = String::new();

        if should_add {
            let output_index = self.allocate_output_index();
            let Some(state) = self.tools.get_mut(&index) else {
                return output;
            };
            if state.call_id.is_empty() {
                state.call_id = format!("call_{index}");
            }
            state.output_index = Some(output_index);
            state.item_id = response_tool_call_item_id_from_chat_name(
                &state.call_id,
                &state.name,
                &self.tool_context,
            );
            state.added = true;
            let item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "in_progress",
                &state.call_id,
                &state.name,
                "",
                &self.tool_context,
            );
            push_sse(
                &mut output,
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": item
                }),
            );
            if !state.arguments.is_empty() && !is_custom_tool {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "delta": state.arguments
                    }),
                );
            }
        } else if !args_delta.is_empty() && !is_custom_tool {
            if let Some(output_index) = output_index {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": item_id,
                        "output_index": output_index,
                        "delta": args_delta
                    }),
                );
            }
        }

        output
    }

    fn finalize_tools(&mut self) -> (String, Vec<(usize, Value)>) {
        let mut output = String::new();
        let mut items = Vec::new();
        let keys = self.tools.keys().copied().collect::<Vec<_>>();

        for key in keys {
            if self.tools.get(&key).map(|state| state.done).unwrap_or(true) {
                continue;
            }
            if self
                .tools
                .get(&key)
                .map(|state| state.name.is_empty())
                .unwrap_or(true)
            {
                if let Some(state) = self.tools.get_mut(&key) {
                    state.done = true;
                }
                continue;
            }

            let should_add = self.tools.get(&key).is_some_and(|state| !state.added);
            if should_add {
                let output_index = self.allocate_output_index();
                let Some(state) = self.tools.get_mut(&key) else {
                    continue;
                };
                if state.call_id.is_empty() {
                    state.call_id = format!("call_{key}");
                }
                state.output_index = Some(output_index);
                state.item_id = response_tool_call_item_id_from_chat_name(
                    &state.call_id,
                    &state.name,
                    &self.tool_context,
                );
                state.added = true;
                let item = response_tool_call_item_from_chat_name(
                    &state.item_id,
                    "in_progress",
                    &state.call_id,
                    &state.name,
                    "",
                    &self.tool_context,
                );
                push_sse(
                    &mut output,
                    "response.output_item.added",
                    json!({
                        "type": "response.output_item.added",
                        "output_index": output_index,
                        "item": item
                    }),
                );
            }

            let Some(state) = self.tools.get_mut(&key) else {
                continue;
            };
            let output_index = state.output_index.unwrap_or(key + 1);
            let arguments = canonicalize_tool_arguments_str(&state.arguments);
            let is_custom_tool = self.tool_context.is_custom_tool_chat_name(&state.name);
            let mut item = response_tool_call_item_from_chat_name(
                &state.item_id,
                "completed",
                &state.call_id,
                &state.name,
                &arguments,
                &self.tool_context,
            );
            if !state.thought_signature.is_empty() {
                thought_signatures::set_chat_signature(&mut item, &state.thought_signature);
            }
            state.done = true;
            items.push((output_index, item.clone()));

            if is_custom_tool {
                let input = custom_tool_input_from_chat_arguments(&arguments);
                if !input.is_empty() {
                    push_sse(
                        &mut output,
                        "response.custom_tool_call_input.delta",
                        json!({
                            "type": "response.custom_tool_call_input.delta",
                            "item_id": state.item_id,
                            "output_index": output_index,
                            "delta": input
                        }),
                    );
                }
                push_sse(
                    &mut output,
                    "response.custom_tool_call_input.done",
                    json!({
                        "type": "response.custom_tool_call_input.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "input": input
                    }),
                );
            } else {
                push_sse(
                    &mut output,
                    "response.function_call_arguments.done",
                    json!({
                        "type": "response.function_call_arguments.done",
                        "item_id": state.item_id,
                        "output_index": output_index,
                        "arguments": arguments
                    }),
                );
            }
            push_sse(
                &mut output,
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": item
                }),
            );
        }

        (output, items)
    }
}
