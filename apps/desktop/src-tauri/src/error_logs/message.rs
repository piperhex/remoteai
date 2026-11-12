pub(super) const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_INPUT_CHARS: usize = 8_192;

/// Bound log text without replacing values or collapsing whitespace inside paths and error details.
pub(super) fn normalize(value: &str) -> Option<String> {
    let normalized: String = value
        .chars()
        .take(MAX_INPUT_CHARS)
        .filter(|ch| !ch.is_control() || matches!(*ch, '\n' | '\r' | '\t'))
        .take(MAX_MESSAGE_CHARS)
        .collect();
    let normalized = normalized.trim();
    (!normalized.is_empty()).then(|| normalized.to_owned())
}
