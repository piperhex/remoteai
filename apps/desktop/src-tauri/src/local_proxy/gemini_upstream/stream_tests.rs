use serde_json::{json, Value};
use std::io::{BufReader, Cursor, Read};

use super::stream::GenerateContentReader;

fn convert(input: &str) -> String {
    let native = GenerateContentReader::new(Cursor::new(input.as_bytes()), None);
    let mut reader = super::super::ChatSseReader::new(
        BufReader::new(native),
        "gemini-3-flash".into(),
        Default::default(),
        None,
    );
    let mut output = String::new();
    reader.read_to_string(&mut output).unwrap();
    output
}

#[test]
fn native_error_status_and_malformed_json_remain_specific_after_conversion() {
    for (input, expected) in [
        ("data: {\"error\":{\"code\":403,\"status\":\"PERMISSION_DENIED\",\"message\":\"private\"}}\n\n",
            "无权访问"),
        ("data: {\"error\":{\"code\":429,\"message\":\"private\"}}\n\n", "HTTP 429"),
        ("data: {bad}\n\n", "JSON 语法无效"),
        ("data: {\"candidates\":[]}\n\n", "结束原因"),
    ] {
        let output = convert(input);
        assert!(output.contains("response.failed"), "{output}");
        assert!(output.contains(expected), "{output}");
        assert!(!output.contains("response.completed"));
        assert!(!output.contains("private"));
        assert!(!output.contains("proxy_request_error:"));
    }
}

#[test]
fn failed_tool_generation_preserves_reported_usage_without_completing_the_response() {
    let input = json!({"candidates":[{"finishReason":"MALFORMED_FUNCTION_CALL"}],
        "usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":7}});
    let output = convert(&format!("data: {input}\n\n"));
    let response = terminal(&output);
    assert_eq!(response["status"], "failed");
    assert_eq!(response["usage"]["input_tokens"], 11);
    assert_eq!(response["usage"]["output_tokens"], 7);
    assert_eq!(response["usage"]["usage_incomplete"], true);
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("工具调用参数"));
}

#[test]
fn native_stream_accepts_events_content_and_metadata_above_previous_limits() {
    let text = "x".repeat(8 * 1024 * 1024 + 1);
    let first = json!({"candidates":[{"content":{"parts":[{"text":text}]}}]});
    let last = json!({"candidates":[{"content":{"parts":[{"text":text}]}, "finishReason":"STOP",
        "groundingMetadata":{"extra":text}}]});
    let output = convert(&format!("data: {first}\n\ndata: {last}\n\n"));
    let result = terminal(&output);
    assert_eq!(result["status"], "completed");
    assert_eq!(
        result["output"][0]["content"][0]["text"]
            .as_str()
            .unwrap()
            .len(),
        text.len() * 2
    );
}

pub(super) fn terminal(output: &str) -> Value {
    output
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|value| serde_json::from_str::<Value>(value).ok())
        .filter_map(|value| value.get("response").cloned())
        .next_back()
        .unwrap()
}

pub(super) fn tool_stream() -> String {
    [
        json!({"candidates":[{"content":{"parts":[{"text":"Plan","thought":true},{"text":"Hello"}]}}],
            "usageMetadata":{"promptTokenCount":20,"cachedContentTokenCount":10}}),
        json!({"candidates":[{"content":{"parts":[
            {"functionCall":{"name":"run","args":{"x":1}},"thoughtSignature":"opaque"},
            {"functionCall":{"name":"read","args":{}}}
        ]},"finishReason":"STOP"}]}),
        json!({"usageMetadata":{"candidatesTokenCount":5,"thoughtsTokenCount":4,"totalTokenCount":29}}),
    ].iter().map(|value|format!("data: {value}\n\n")).collect()
}

#[test]
fn native_stream_maps_thoughts_parallel_tools_and_trailing_partial_usage() {
    let output = convert(&tool_stream());
    assert!(output.contains("event: response.reasoning_summary_text.delta"));
    assert!(output.contains("event: response.function_call_arguments.delta"));
    let final_response = terminal(&output);
    assert_eq!(final_response["status"], "completed");
    assert_eq!(final_response["usage"]["input_tokens"], 20);
    assert_eq!(final_response["usage"]["output_tokens"], 9);
    let calls = final_response["output"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["type"] == "function_call")
        .collect::<Vec<_>>();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0]["arguments"], "{\"x\":1}");
    assert_ne!(calls[0]["call_id"], calls[1]["call_id"]);
    assert_eq!(
        calls[0]["extra_content"]["google"]["thought_signature"],
        "opaque"
    );
    assert!(calls[1].get("extra_content").is_none());
    for item in final_response["output"].as_array().unwrap() {
        if item["type"] != "function_call" {
            assert!(!item.to_string().contains("opaque"));
        }
    }
}

#[test]
fn native_stream_requires_finish_reason_and_preserves_late_errors() {
    for input in [
        "data: invalid\n\n".to_string(),
        format!(
            "data: {}\n\n",
            json!({"candidates":[{"content":{"parts":[{"text":"Partial"}]}}]})
        ),
        format!(
            "{}data: {}\n\n",
            tool_stream(),
            json!({"error":{"code":500,"message":"private"}})
        ),
    ] {
        let output = convert(&input);
        assert_eq!(terminal(&output)["status"], "failed");
        assert!(!output.contains("event: response.completed"));
        assert!(!output.contains("private"));
    }
}

#[test]
fn native_stream_keeps_limits_and_safety_incomplete() {
    for (reason, expected) in [
        ("MAX_TOKENS", "max_output_tokens"),
        ("SAFETY", "content_filter"),
    ] {
        let output = convert(&format!(
            "data: {}\n\n",
            json!({"candidates":[{"finishReason":reason}]})
        ));
        let final_response = terminal(&output);
        assert_eq!(final_response["status"], "incomplete");
        assert_eq!(final_response["incomplete_details"]["reason"], expected);
    }
}

#[test]
fn native_stream_accepts_multiline_data_and_final_event_without_blank_line() {
    let input = concat!(
        "data: {\"candidates\":[\n",
        "data: {\"content\":{\"parts\":[{\"text\":\"Hello\"}]},",
        "\"finishReason\":\"STOP\"}]}\n"
    );
    assert_eq!(terminal(&convert(input))["status"], "completed");
}
