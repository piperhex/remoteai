pub(super) const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_INPUT_CHARS: usize = 8_192;
const OPAQUE_SECRET_MIN_CHARS: usize = 32;
const HIDDEN: &str = "[已隐藏]";
const SENSITIVE_FIELDS: &[&str] = &[
    "authorization",
    "access_token",
    "refresh_token",
    "id_token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "api_key",
    "api-key",
    "apikey",
    "password",
    "secret",
    "client_secret",
    "clientsecret",
    "token",
    "cookie",
    "set-cookie",
];

/// Client-facing responses omit credentials and locations; diagnostic logs use `message::normalize`.
pub(super) fn message(value: &str) -> Option<String> {
    let bounded: String = value.chars().take(MAX_INPUT_CHARS).collect();
    let redacted = redact_paths(&redact_assignments(&bounded));
    let mut hide_next = false;
    let words: Vec<_> = redacted
        .split_whitespace()
        .map(|word| {
            if hide_next {
                hide_next = false;
                return HIDDEN.to_string();
            }
            let scheme = word.trim_matches(|ch: char| !ch.is_ascii_alphanumeric());
            if scheme.eq_ignore_ascii_case("bearer") || scheme.eq_ignore_ascii_case("basic") {
                hide_next = true;
                return word.to_string();
            }
            if contains_secret(word) {
                HIDDEN.to_string()
            } else {
                word.to_string()
            }
        })
        .collect();
    let normalized: String = words
        .join(" ")
        .chars()
        .filter(|ch| !ch.is_control())
        .take(MAX_MESSAGE_CHARS)
        .collect();
    (!normalized.is_empty()).then_some(normalized)
}

fn contains_secret(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    let candidate = word.trim_matches(['\'', '"', '(', ')', '[', ']', ',', ';', '：', '，', '。']);
    lower.contains("sk-")
        || word.contains("eyJ")
        || lower.contains("http://")
        || lower.contains("https://")
        || lower.contains("file://")
        || (candidate.len() >= OPAQUE_SECRET_MIN_CHARS
            && candidate
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || "_-./=".contains(ch))
            && candidate.chars().any(|ch| ch.is_ascii_digit())
            && candidate.chars().any(|ch| ch.is_ascii_alphabetic()))
}

fn redact_assignments(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut output = String::new();
    let mut cursor = 0;
    while cursor < value.len() {
        let Some((start, end)) = next_assignment(&lower, cursor) else {
            break;
        };
        output.push_str(&value[cursor..start]);
        output.push_str(HIDDEN);
        cursor = end;
    }
    output.push_str(&value[cursor..]);
    output
}

fn next_assignment(value: &str, cursor: usize) -> Option<(usize, usize)> {
    value[cursor..].char_indices().find_map(|(offset, _)| {
        let start = cursor + offset;
        if value[..start]
            .chars()
            .next_back()
            .is_some_and(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        {
            return None;
        }
        SENSITIVE_FIELDS.iter().find_map(|field| {
            if !value[start..].starts_with(field) {
                return None;
            }
            assignment_value(value, start + field.len(), field)
        })
    })
}

fn assignment_value(value: &str, mut cursor: usize, field: &str) -> Option<(usize, usize)> {
    cursor = skip_chars(value, cursor, |ch| {
        ch.is_whitespace() || matches!(ch, '\'' | '"')
    });
    if !value[cursor..].starts_with([':', '=']) {
        return None;
    }
    cursor += 1;
    cursor = skip_chars(value, cursor, char::is_whitespace);
    let quote = value[cursor..]
        .chars()
        .next()
        .filter(|ch| matches!(ch, '\'' | '"'));
    let start = cursor;
    if let Some(quote) = quote {
        return Some((
            start,
            quoted_value_end(value, cursor + quote.len_utf8(), quote),
        ));
    }
    if matches!(field, "authorization" | "cookie" | "set-cookie") {
        // Header values may contain schemes, spaces and many semicolon-separated credentials.
        let end = skip_chars(value, cursor, |ch| !matches!(ch, '\r' | '\n'));
        return (end > start).then_some((start, end));
    }
    let end = skip_chars(value, cursor, |ch| {
        !ch.is_whitespace() && !matches!(ch, ',' | ';' | '}' | ')' | '\'' | '"')
    });
    (end > start).then_some((start, end))
}

fn quoted_value_end(value: &str, cursor: usize, quote: char) -> usize {
    let mut escaped = false;
    for (offset, ch) in value[cursor..].char_indices() {
        if escaped {
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == quote {
            return cursor + offset + ch.len_utf8();
        }
    }
    value.len()
}

fn skip_chars(value: &str, cursor: usize, predicate: impl Fn(char) -> bool) -> usize {
    cursor
        + value[cursor..]
            .chars()
            .take_while(|ch| predicate(*ch))
            .map(char::len_utf8)
            .sum::<usize>()
}

fn redact_paths(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    for (start, _) in value.char_indices() {
        if start < cursor {
            continue;
        }
        let is_url = ["http://", "https://", "file://"].iter().any(|prefix| {
            value[start..]
                .get(..prefix.len())
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
        });
        if !is_url && !is_path_start(value, start) {
            continue;
        }
        output.push_str(&value[cursor..start]);
        // Hide the complete URL before its scheme suffix can be mistaken for a Windows drive.
        output.push_str(if is_url {
            HIDDEN
        } else {
            "[本地路径已隐藏]"
        });
        let quote = value[..start]
            .chars()
            .next_back()
            .filter(|ch| matches!(ch, '\'' | '"'));
        cursor = skip_chars(value, start, |ch| match quote {
            Some(quote) => ch != quote,
            None => !ch.is_whitespace() && !matches!(ch, ',' | ';' | ')' | '\'' | '"'),
        });
    }
    output.push_str(&value[cursor..]);
    output
}

fn is_path_start(value: &str, start: usize) -> bool {
    let bytes = &value.as_bytes()[start..];
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    let boundary = value[..start]
        .chars()
        .next_back()
        .is_none_or(|ch| ch.is_whitespace() || "(=:['\"".contains(ch));
    drive || (boundary && (value[start..].starts_with("\\\\") || value[start..].starts_with('/')))
}
