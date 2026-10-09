use super::{
    ProxySessionFirstResponseContext, ProxySessionRequestGuard, UpstreamBody, UpstreamPayload,
};
use serde_json::Value;
use std::io::{self, Read};

const MAX_EVENT_BYTES: usize = 256 * 1024;

/// Measures the first observable output delta, not SSE status events or response headers.
pub(super) fn capture(
    mut payload: UpstreamPayload,
    session: Option<&ProxySessionRequestGuard>,
) -> UpstreamPayload {
    let Some(session) = session else {
        return payload;
    };
    if !super::status_ok(payload.status)
        || !(session.expects_event_stream
            || super::is_event_stream(payload.content_type.as_deref()))
    {
        return payload;
    }
    // Buffered responses cannot provide a reliable first-token measurement.
    if let UpstreamBody::Streaming(inner) = payload.body {
        payload.body = UpstreamBody::Streaming(Box::new(FirstTokenReader {
            inner,
            context: Some(session.first_response_context()),
            detector: FirstTokenDetector::default(),
        }));
    }
    payload
}

struct FirstTokenReader {
    inner: Box<dyn Read + Send>,
    context: Option<ProxySessionFirstResponseContext>,
    detector: FirstTokenDetector,
}

impl Read for FirstTokenReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(target)?;
        if self.context.is_some() && self.detector.observe(&target[..count]) {
            if let Some(context) = self.context.take() {
                record(&context);
            }
        }
        Ok(count)
    }
}

fn record(context: &ProxySessionFirstResponseContext) {
    let elapsed = context.started_at.elapsed().as_millis() as u64;
    if let Ok(mut sessions) = super::proxy_sessions().lock() {
        if let Some(request) = sessions.get_mut(&context.session_id).and_then(|session| {
            session
                .requests
                .iter_mut()
                .find(|request| request.id == context.request_id)
        }) {
            request.first_token_time_ms.get_or_insert(elapsed);
        }
    }
    super::persist_proxy_session(&context.session_id, Some(context.request_id));
}

#[derive(Default)]
struct FirstTokenDetector {
    event: Vec<u8>,
    newlines: u8,
    finished: bool,
}

impl FirstTokenDetector {
    fn observe(&mut self, bytes: &[u8]) -> bool {
        if self.finished {
            return false;
        }
        for &byte in bytes {
            if self.event.len() >= MAX_EVENT_BYTES {
                // Leave TTFT unknown if we cannot inspect the whole event safely.
                self.finished = true;
                self.event.clear();
                return false;
            }
            self.event.push(byte);
            match byte {
                b'\n' => self.newlines += 1,
                b'\r' => {}
                _ => self.newlines = 0,
            }
            if self.newlines < 2 {
                continue;
            }
            let found = event_has_output(&self.event);
            self.event.clear();
            self.newlines = 0;
            if found {
                self.finished = true;
                return true;
            }
        }
        false
    }
}

fn event_has_output(bytes: &[u8]) -> bool {
    let Ok(event) = std::str::from_utf8(bytes) else {
        return false;
    };
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n");
    let Ok(value) = serde_json::from_str::<Value>(&data) else {
        return false;
    };
    let kind = value["type"]
        .as_str()
        .or_else(|| {
            event
                .lines()
                .find_map(|line| line.strip_prefix("event:").map(str::trim))
        })
        .unwrap_or_default();
    has_output_delta(&value, kind)
}

fn nonempty(value: &Value) -> bool {
    value.as_str().is_some_and(|text| !text.is_empty())
}

fn has_output_delta(value: &Value, kind: &str) -> bool {
    match kind {
        "response.output_text.delta"
        | "response.reasoning_text.delta"
        | "response.reasoning_summary_text.delta"
        | "response.function_call_arguments.delta"
        | "response.custom_tool_call_input.delta"
        | "response.refusal.delta" => nonempty(&value["delta"]),
        "content_block_delta" => ["text", "thinking", "partial_json"]
            .iter()
            .any(|key| nonempty(&value["delta"][key])),
        _ => value["choices"]
            .as_array()
            .is_some_and(|choices| choices.iter().any(chat_output)),
    }
}

fn chat_output(choice: &Value) -> bool {
    let delta = &choice["delta"];
    ["content", "reasoning_content", "reasoning", "refusal"]
        .iter()
        .any(|key| nonempty(&delta[key]))
        || nonempty(&delta["function_call"]["arguments"])
        || delta["tool_calls"].as_array().is_some_and(|calls| {
            calls
                .iter()
                .any(|call| nonempty(&call["function"]["arguments"]))
        })
}

#[cfg(test)]
#[path = "tests/first_token.rs"]
mod tests;
