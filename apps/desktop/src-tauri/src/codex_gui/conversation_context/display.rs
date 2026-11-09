//! Strip private snapshots even when the CLI joins them to ordinary message text.
use serde_json::{json, Value};

use super::{Context, CONTEXT_END, CONTEXT_START, REFERENCE_PREFIX};

fn closing_tag(text: &str) -> Option<usize> {
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in text.char_indices() {
        if escaped {
            escaped = false;
        } else if quoted && character == '\\' {
            escaped = true;
        } else if character == '"' {
            quoted = !quoted;
        } else if !quoted && text[index..].starts_with(CONTEXT_END) {
            return Some(index);
        }
    }
    None
}

fn reference(payload: &str) -> Option<Value> {
    let (id, name, prefix) = match serde_json::from_str(payload.trim()).ok()? {
        Context::Ssh { id, name, .. }
            if super::super::ssh_reference::reference_id(&format!("ssh-profile://{id}"))
                .is_ok() =>
        {
            (id, name, super::super::ssh_reference::PREFIX)
        }
        Context::Reference { id, name, .. } => (id, name, REFERENCE_PREFIX),
        Context::Coze { id, name, .. } if uuid::Uuid::parse_str(&id).is_ok() && id.len() == 36 => {
            (id, name, "coze://")
        }
        _ => return None,
    };
    Some(json!({"type": "mention", "name": name, "path": format!("{prefix}{id}")}))
}

/// Private envelopes may be independent inputs, concatenated history, or an incomplete trailing snapshot.
pub(super) fn visible_part(part: Value) -> Vec<Value> {
    let Some(text) = part["text"].as_str().filter(|_| part["type"] == "text") else {
        return vec![part];
    };
    if !text.contains(CONTEXT_START) {
        return vec![part];
    }
    let mut remaining = text;
    let mut visible = String::new();
    let mut references = Vec::new();
    while let Some((before, payload)) = remaining.split_once(CONTEXT_START) {
        visible.push_str(before);
        let Some(end) = closing_tag(payload) else {
            remaining = "";
            break;
        };
        if let Some(reference) = reference(&payload[..end]) {
            references.push(reference);
        }
        remaining = &payload[end + CONTEXT_END.len()..];
    }
    visible.push_str(remaining);
    let mut parts = Vec::new();
    if !visible.trim().is_empty() {
        // Stored text-element offsets no longer describe the filtered message.
        parts.push(json!({"type": "text", "text": visible.trim_end(), "text_elements": []}));
    }
    parts.extend(references);
    parts
}

pub(super) fn visible_preview(preview: &str) -> String {
    let Some((text, _)) = preview.split_once(CONTEXT_START) else {
        return preview.to_owned();
    };
    if text.trim().is_empty() {
        "对话引用".to_owned()
    } else {
        text.trim_end().to_owned()
    }
}

/// Sanitize only user messages and thread previews; tool results and assistant prose remain intact.
pub(in crate::codex_gui) fn display(value: &mut Value) {
    if let Some(Value::String(preview)) = value.get_mut("preview") {
        *preview = visible_preview(preview);
    }
    if value["type"] == "userMessage" {
        if let Some(parts) = value["content"].as_array_mut() {
            *parts = parts.drain(..).flat_map(visible_part).collect();
        }
        return;
    }
    for key in ["thread", "turn", "item"] {
        if let Some(child) = value.get_mut(key) {
            display(child);
        }
    }
    for key in ["data", "turns", "items"] {
        if let Some(children) = value.get_mut(key).and_then(Value::as_array_mut) {
            children.iter_mut().for_each(display);
        }
    }
}
