use crate::models::ProviderProfile;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 128;
const MAX_BYTES: usize = 16 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Scope {
    provider: String,
    endpoint: String,
    model: String,
    session: String,
}

impl Scope {
    pub(super) fn new(
        provider: &ProviderProfile,
        headers: &[(String, String)],
        model: &str,
    ) -> Option<Self> {
        let session = super::super::proxy_session_id(headers)?;
        if session.len() > super::super::MAX_CONTINUATION_SCOPE_ID_BYTES
            || session.chars().any(char::is_control)
        {
            return None;
        }
        Some(Self {
            provider: provider.id.clone(),
            endpoint: provider.base_url.clone(),
            model: model.into(),
            session,
        })
    }

    #[cfg(test)]
    pub(super) fn fixture(session: &str) -> Self {
        Self {
            provider: "fixture".into(),
            endpoint: "fixture".into(),
            model: "gemini".into(),
            session: session.into(),
        }
    }
}

struct Entry {
    scope: Scope,
    key: Value,
    parts: Vec<Value>,
    expires: Instant,
    bytes: usize,
}
#[derive(Default)]
struct Store {
    entries: VecDeque<Entry>,
    bytes: usize,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}

/// Signed parts must remain ordered and unchanged, including signatures on empty text parts.
pub(super) fn capture(scope: Option<&Scope>, original: &[Value], call_ids: &[String]) {
    let Some(scope) = scope else { return };
    if !original
        .iter()
        .any(|part| part["thoughtSignature"].is_string())
    {
        return;
    }
    let mut keyed = original.to_vec();
    for (part, id) in keyed
        .iter_mut()
        .filter(|part| part.get("functionCall").is_some())
        .zip(call_ids)
    {
        part["functionCall"]["id"] = json!(id);
    }
    let Some(key) = fingerprint(&keyed) else {
        return;
    };
    let bytes = original
        .iter()
        .map(|part| part.to_string().len())
        .sum::<usize>()
        + key.to_string().len();
    if bytes > MAX_BYTES {
        return;
    }
    // Cached continuation data is optional and must not prevent a response from being delivered.
    let Ok(mut store) = store().lock() else {
        return;
    };
    store.prune();
    store.entries.push_back(Entry {
        scope: scope.clone(),
        key,
        parts: original.to_vec(),
        expires: Instant::now() + TTL,
        bytes,
    });
    store.bytes = store.bytes.saturating_add(bytes);
    while store.entries.len() > MAX_ENTRIES || store.bytes > MAX_BYTES {
        store.pop();
    }
}

pub(super) fn restore(scope: Option<&Scope>, parts: &mut Vec<Value>) {
    let Some(scope) = scope else { return };
    let Some(key) = fingerprint(parts) else {
        return;
    };
    // Missing history or a poisoned cache leaves the supplied conversation unchanged.
    let Ok(mut store) = store().lock() else {
        return;
    };
    store.prune();
    let mut matching = store
        .entries
        .iter()
        .filter(|entry| entry.scope == *scope && entry.key == key);
    let Some(first) = matching.next() else { return };
    if matching.any(|entry| entry.parts != first.parts) {
        return;
    }
    if !compatible_signatures(parts, &first.parts) {
        return;
    }
    *parts = first.parts.clone();
}

fn compatible_signatures(supplied: &[Value], original: &[Value]) -> bool {
    // A client can retain tool proofs but omit signed text parts. Restore the complete
    // cached response only when every supplied proof agrees with its original call.
    if supplied
        .iter()
        .any(|part| part.get("thoughtSignature").is_some() && part.get("functionCall").is_none())
    {
        return false;
    }
    let originals = original
        .iter()
        .filter(|part| part.get("functionCall").is_some());
    supplied
        .iter()
        .filter(|part| part.get("functionCall").is_some())
        .zip(originals)
        .all(|(part, cached)| {
            part.get("thoughtSignature").is_none_or(|signature| {
                signature.as_str().is_none_or(str::is_empty)
                    || *signature == cached["thoughtSignature"]
            })
        })
}

fn fingerprint(parts: &[Value]) -> Option<Value> {
    let calls = parts
        .iter()
        .filter_map(|part| part.get("functionCall"))
        .map(|call| {
            json!({ "id": call["id"], "name": call["name"],
            "args": call.get("args").cloned().unwrap_or_else(|| json!({})) })
        })
        .collect::<Vec<_>>();
    if calls.is_empty() {
        return None;
    }
    let text = parts
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect::<String>();
    Some(json!({ "text": text, "calls": calls }))
}

impl Store {
    fn prune(&mut self) {
        let now = Instant::now();
        while self
            .entries
            .front()
            .is_some_and(|entry| entry.expires <= now)
        {
            self.pop();
        }
    }

    fn pop(&mut self) {
        if let Some(entry) = self.entries.pop_front() {
            self.bytes = self.bytes.saturating_sub(entry.bytes);
        }
    }
}
