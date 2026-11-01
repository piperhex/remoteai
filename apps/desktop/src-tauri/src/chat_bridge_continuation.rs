use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use serde_json::{Map, Value};

#[path = "chat_bridge_continuation_details.rs"]
mod details;
#[path = "chat_bridge_history.rs"]
mod history;
pub(crate) use details::{capture_reasoning_details, reasoning_details_for_item};
pub(crate) use history::{capture_response, restore_tool_history};

const CONTINUATION_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_CONTINUATION_ENTRIES: usize = 512;
const MAX_CONTINUATION_BYTES: usize = 32 * 1024 * 1024;
const MAX_REASONING_BYTES: usize = 4 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct ContinuationScope {
    provider_id: String,
    session_id: String,
}

impl ContinuationScope {
    pub(crate) fn new(provider_id: &str, session_id: &str) -> Self {
        Self {
            provider_id: provider_id.to_string(),
            session_id: session_id.to_string(),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ContinuationKey {
    scope: ContinuationScope,
    reference: ContinuationReference,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum ContinuationReference {
    ToolCall(String),
    ReasoningItem(String),
}

#[derive(Clone)]
struct ContinuationEntry {
    reasoning_content: Option<Arc<str>>,
    reasoning_details: Option<Arc<Value>>,
    thought_signature: Option<Arc<str>>,
    expires_at: Instant,
    sequence: u64,
    bytes: usize,
}

#[derive(Default)]
struct ContinuationStore {
    entries: HashMap<ContinuationKey, ContinuationEntry>,
    next_sequence: u64,
}

pub(crate) fn capture_message(scope: &ContinuationScope, message: &Value) {
    // Continuation metadata is best-effort; cache poisoning must not fail proxy requests.
    let Ok(mut store) = continuation_store().lock() else {
        return;
    };
    store.capture_message(scope, message, Instant::now());
}

pub(crate) fn restore_messages(scope: &ContinuationScope, messages: &mut [Value]) {
    // Continuation metadata is best-effort; cache poisoning must not fail proxy requests.
    let Ok(mut store) = continuation_store().lock() else {
        return;
    };
    store.restore_messages(scope, messages, Instant::now());
}

/// Retain plaintext by item identity when a client later returns an encrypted-only history item.
pub(crate) fn capture_reasoning(scope: &ContinuationScope, item_id: &str, text: &str) {
    // Match the existing best-effort continuation cache behavior on lock poisoning.
    if let Ok(mut store) = continuation_store().lock() {
        store.capture_reasoning(scope, (item_id, text), Instant::now());
    }
}

pub(crate) fn reasoning_for_item(scope: &ContinuationScope, item_id: &str) -> Option<String> {
    let mut store = continuation_store().lock().ok()?;
    store.remove_expired(Instant::now());
    let key = ContinuationKey {
        scope: scope.clone(),
        reference: ContinuationReference::ReasoningItem(item_id.to_string()),
    };
    store
        .entries
        .get(&key)?
        .reasoning_content
        .as_ref()
        .map(|text| text.to_string())
}

fn continuation_store() -> &'static Mutex<ContinuationStore> {
    static STORE: OnceLock<Mutex<ContinuationStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(ContinuationStore::default()))
}

impl ContinuationStore {
    fn capture_reasoning(
        &mut self,
        scope: &ContinuationScope,
        snapshot: (&str, &str),
        now: Instant,
    ) {
        let (item_id, text) = snapshot;
        if text.is_empty()
            || text.len() > MAX_REASONING_BYTES
            || item_id.len() > MAX_SIGNATURE_BYTES
        {
            return;
        }
        self.remove_expired(now);
        self.next_sequence = self.next_sequence.wrapping_add(1);
        let key = ContinuationKey {
            scope: scope.clone(),
            reference: ContinuationReference::ReasoningItem(item_id.to_string()),
        };
        self.entries.insert(
            key,
            ContinuationEntry {
                reasoning_content: Some(Arc::from(text)),
                reasoning_details: None,
                thought_signature: None,
                expires_at: now + CONTINUATION_TTL,
                sequence: self.next_sequence,
                bytes: item_id.len() + text.len(),
            },
        );
        self.enforce_limits();
    }

    fn capture_message(&mut self, scope: &ContinuationScope, message: &Value, now: Instant) {
        self.remove_expired(now);
        let reasoning_content =
            bounded_field(message.get("reasoning_content"), MAX_REASONING_BYTES);
        let reasoning_details = details::bounded_details(message.get("reasoning_details"));
        let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) else {
            return;
        };
        for tool_call in tool_calls {
            self.capture_tool_call(
                scope,
                tool_call,
                (reasoning_content.clone(), reasoning_details.clone()),
                now,
            );
        }
        self.enforce_limits();
    }

    fn capture_tool_call(
        &mut self,
        scope: &ContinuationScope,
        tool_call: &Value,
        reasoning: (Option<Arc<str>>, Option<Arc<Value>>),
        now: Instant,
    ) {
        let (reasoning_content, reasoning_details) = reasoning;
        let Some(call_id) = non_empty_string(tool_call.get("id")) else {
            return;
        };
        let thought_signature = bounded_field(
            tool_call.pointer("/extra_content/google/thought_signature"),
            MAX_SIGNATURE_BYTES,
        );
        if reasoning_content.is_none() && reasoning_details.is_none() && thought_signature.is_none()
        {
            return;
        }
        let bytes = entry_bytes(&call_id, &reasoning_content, &thought_signature)
            + reasoning_details
                .as_ref()
                .map_or(0, |value| value.to_string().len());
        if bytes > MAX_CONTINUATION_BYTES {
            return;
        }
        self.next_sequence = self.next_sequence.wrapping_add(1);
        let key = ContinuationKey {
            scope: scope.clone(),
            reference: ContinuationReference::ToolCall(call_id),
        };
        self.entries.insert(
            key,
            ContinuationEntry {
                reasoning_content,
                reasoning_details,
                thought_signature,
                expires_at: now + CONTINUATION_TTL,
                sequence: self.next_sequence,
                bytes,
            },
        );
    }

    fn restore_messages(
        &mut self,
        scope: &ContinuationScope,
        messages: &mut [Value],
        now: Instant,
    ) {
        self.remove_expired(now);
        for message in messages {
            self.restore_message(scope, message);
        }
    }

    fn restore_message(&self, scope: &ContinuationScope, message: &mut Value) {
        let Some(tool_calls) = message.get_mut("tool_calls").and_then(Value::as_array_mut) else {
            return;
        };
        let continuations = tool_calls
            .iter()
            .map(|tool_call| self.continuation_for_tool_call(scope, tool_call))
            .collect::<Vec<_>>();
        restore_reasoning_content(message, &continuations);
        details::restore_details(message, &continuations);
        let Some(tool_calls) = message.get_mut("tool_calls").and_then(Value::as_array_mut) else {
            return;
        };
        for (tool_call, continuation) in tool_calls.iter_mut().zip(continuations) {
            if let Some(signature) = continuation.and_then(|entry| entry.thought_signature) {
                restore_thought_signature(tool_call, &signature);
            }
        }
    }

    fn continuation_for_tool_call(
        &self,
        scope: &ContinuationScope,
        tool_call: &Value,
    ) -> Option<ContinuationEntry> {
        let call_id = non_empty_string(tool_call.get("id"))?;
        let key = ContinuationKey {
            scope: scope.clone(),
            reference: ContinuationReference::ToolCall(call_id),
        };
        self.entries.get(&key).cloned()
    }

    fn remove_expired(&mut self, now: Instant) {
        self.entries.retain(|_, entry| entry.expires_at > now);
    }

    fn enforce_limits(&mut self) {
        while self.entries.len() > MAX_CONTINUATION_ENTRIES
            || self.total_bytes() > MAX_CONTINUATION_BYTES
        {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.sequence)
                .map(|(key, _)| key.clone())
            else {
                return;
            };
            self.entries.remove(&oldest);
        }
    }

    fn total_bytes(&self) -> usize {
        self.entries.values().map(|entry| entry.bytes).sum()
    }
}

fn restore_reasoning_content(message: &mut Value, continuations: &[Option<ContinuationEntry>]) {
    if message.get("reasoning_content").is_some() {
        return;
    }
    let reasoning = continuations
        .iter()
        .filter_map(Option::as_ref)
        .find_map(|entry| entry.reasoning_content.as_ref());
    if let Some(reasoning) = reasoning {
        message["reasoning_content"] = Value::String(reasoning.to_string());
    }
}

fn restore_thought_signature(tool_call: &mut Value, signature: &str) {
    let Some(tool_call) = tool_call.as_object_mut() else {
        return;
    };
    let extra_content = object_field(tool_call, "extra_content");
    let google = object_field(extra_content, "google");
    if non_empty_string(google.get("thought_signature")).is_none() {
        google.insert("thought_signature".to_string(), Value::String(signature.to_string()));
    }
}

fn object_field<'a>(object: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let value = object
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    match value {
        Value::Object(object) => object,
        _ => unreachable!("the value is replaced with an object above"),
    }
}

fn bounded_field(value: Option<&Value>, max_bytes: usize) -> Option<Arc<str>> {
    let value = non_empty_string(value)?;
    (value.len() <= max_bytes).then(|| Arc::<str>::from(value))
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn entry_bytes(
    call_id: &str,
    reasoning_content: &Option<Arc<str>>,
    thought_signature: &Option<Arc<str>>,
) -> usize {
    call_id.len()
        + reasoning_content.as_ref().map_or(0, |value| value.len())
        + thought_signature.as_ref().map_or(0, |value| value.len())
}

#[cfg(test)]
mod tests {
    use std::thread;

    use serde_json::json;

    use super::*;

    fn captured_message(reasoning: &str, signature: &str) -> Value {
        json!({
            "reasoning_content": reasoning,
            "tool_calls": [{
                "id": "call-shared",
                "extra_content": { "google": { "thought_signature": signature } }
            }]
        })
    }

    fn response_messages() -> Vec<Value> {
        vec![json!({
            "role": "assistant",
            "tool_calls": [{ "id": "call-shared", "type": "function" }]
        })]
    }

    #[test]
    fn expires_continuations_after_the_ttl() {
        let mut store = ContinuationStore::default();
        let scope = ContinuationScope::new("provider", "session");
        let now = Instant::now();
        store.capture_message(&scope, &captured_message("reasoning", "signature"), now);
        store.capture_reasoning(&scope, ("rs_plain", "plain reasoning"), now);
        let mut messages = response_messages();

        store.restore_messages(
            &scope,
            &mut messages,
            now + CONTINUATION_TTL + Duration::from_secs(1),
        );

        assert!(messages[0].get("reasoning_content").is_none());
        assert!(messages[0]["tool_calls"][0].get("extra_content").is_none());
        assert!(store.entries.is_empty());
    }

    #[test]
    fn concurrent_scopes_do_not_share_sensitive_fields() {
        let scopes = [
            ContinuationScope::new("provider", "session-a"),
            ContinuationScope::new("provider", "session-b"),
        ];
        let handles = scopes
            .iter()
            .cloned()
            .zip([
                ("reasoning-a", "signature-a"),
                ("reasoning-b", "signature-b"),
            ])
            .map(|(scope, (reasoning, signature))| {
                thread::spawn(move || {
                    capture_message(&scope, &captured_message(reasoning, signature));
                    let mut messages = response_messages();
                    restore_messages(&scope, &mut messages);
                    messages
                })
            })
            .collect::<Vec<_>>();
        let restored = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(restored[0][0]["reasoning_content"], "reasoning-a");
        assert_eq!(
            restored[1][0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
            "signature-b"
        );
    }
}
