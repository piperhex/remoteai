//! CLI protocol adaptation shares GUI account routing, retries and usage capture.
use super::{gui_routing::GuiProxyRequest, *};

pub(super) fn messages<R: Runtime>(
    request: GuiProxyRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    let source: Value = serde_json::from_slice(&request.body)
        .map_err(|_| "Invalid CLI message request".to_owned())?;
    let model = source["model"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Missing CLI model".to_owned())?;
    bridge_media::validate_anthropic(&source)?;
    validate_anthropic_search_options(&source).map_err(|error| error.to_string())?;
    let body = responses_body(&source, model);
    let encoded =
        serde_json::to_vec(&body).map_err(|_| "Invalid CLI message request".to_owned())?;
    let payload = gui_forwarding::forward(GuiProxyRequest {
        method: &Method::Post,
        url: "/v1/responses",
        body: encoded,
        ..request
    })?;
    convert_responses_payload(payload, source["stream"].as_bool().unwrap_or(false), model)
}

fn responses_body(source: &Value, model: &str) -> Value {
    let mut body = anthropic_to_responses(source, model);
    // The GUI chose this model from its account catalog; never map it to a Claude alias.
    body["model"] = json!(model);
    if let Some(effort) = source
        .pointer("/metadata/remoteai_effort")
        .and_then(Value::as_str)
    {
        body["reasoning"] = json!({"effort": effort});
    }
    if let Some(schema) = source.pointer("/metadata/remoteai_output_schema") {
        body["text"] =
            json!({"format":{"type":"json_schema", "name":"cli_output", "schema":schema}});
    } else if source
        .pointer("/metadata/remoteai_json_output")
        .and_then(Value::as_bool)
        == Some(true)
    {
        body["text"] = json!({"format":{"type":"json_object"}});
    }
    body
}

pub(super) fn count_tokens(body: &[u8]) -> UpstreamPayload {
    // Match the existing local token estimate; model usage still comes from the upstream response.
    json_payload(200, json!({"input_tokens": body.len().div_ceil(4)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_selected_model_reasoning_and_tool_round_trip() {
        let input = json!({"model":"third-party/model", "metadata":{"remoteai_effort":"high"},
            "messages":[{"role":"assistant", "content":[{"type":"tool_use", "id":"call-1",
                "name":"read_file", "input":{"path":"README.md"}}]},
                {"role":"user", "content":[{"type":"tool_result", "tool_use_id":"call-1", "content":"hello"}]}]});
        let body = responses_body(&input, "third-party/model");
        assert_eq!(body["model"], "third-party/model");
        assert_eq!(body["reasoning"]["effort"], "high");
        assert_eq!(body["input"][0]["call_id"], body["input"][1]["call_id"]);
        assert_eq!(body["input"][1]["type"], "function_call_output");
    }

    #[test]
    fn preserves_structured_output_from_gemini() {
        let source = json!({"messages":[], "metadata":{"remoteai_output_schema":
            {"type":"object", "properties":{"route":{"type":"string"}}}}});
        assert_eq!(
            responses_body(&source, "team-model")["text"]["format"]["schema"],
            source["metadata"]["remoteai_output_schema"]
        );
    }
}
