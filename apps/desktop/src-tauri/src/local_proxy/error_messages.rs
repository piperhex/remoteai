//! Translate known connection failures without exposing upstream URLs or credentials.

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) enum TransportFailure {
    TlsClosed,
    Certificate,
    Tls,
    Dns,
    Refused,
    Disconnected,
    ConnectTimeout,
    UploadTimeout,
    ResponseTimeout,
    RedirectLimit,
    RedirectScheme,
    InvalidRequest,
    Proxy,
    Connection,
}

impl TransportFailure {
    pub(super) fn message(self) -> &'static str {
        chinese::transport_message(self)
    }

    // Order matters: certificate and handshake failures also contain generic connection errors.
    const RULES: &'static [(Self, &'static [&'static str])] = &[
        (Self::RedirectLimit, &["redirect limit exceeded"]),
        (Self::RedirectScheme, &["unsupported redirect scheme"]),
        (
            Self::InvalidRequest,
            &[
                "builder error",
                "relative url",
                "invalid url",
                "invalid header",
            ],
        ),
        (
            Self::Proxy,
            &["pac ", "proxy resolution", "proxy configuration"],
        ),
        (Self::UploadTimeout, &["timed out during request upload"]),
        (
            Self::ResponseTimeout,
            &["timed out during response headers"],
        ),
        (
            Self::TlsClosed,
            &["tls handshake eof", "tls handshake: unexpected eof"],
        ),
        (
            Self::Certificate,
            &["certificate", "certnotvalid", "unknownissuer"],
        ),
        (Self::Tls, &["tls handshake", "tls error", "ssl error"]),
        (
            Self::Dns,
            &[
                "dns error",
                "failed to lookup address",
                "name or service not known",
                "os error 11001",
            ],
        ),
        (
            Self::Refused,
            &["connection refused", "actively refused", "os error 10061"],
        ),
        (
            Self::Disconnected,
            &[
                "connection reset",
                "connection closed",
                "broken pipe",
                "os error 10054",
            ],
        ),
        (Self::ConnectTimeout, &["timed out", "timeout"]),
    ];

    pub(super) fn classify(detail: &str) -> Self {
        Self::RULES
            .iter()
            .find(|(_, markers)| markers.iter().any(|marker| detail.contains(marker)))
            .map_or(Self::Connection, |(failure, _)| *failure)
    }
}

pub(super) fn transport(error: &str) -> Option<&'static str> {
    transport_failure(error).map(TransportFailure::message)
}

fn transport_failure(error: &str) -> Option<TransportFailure> {
    let detail = error
        .strip_prefix("Official Codex proxy request failed: ")
        .or_else(|| error.strip_prefix("Provider proxy request failed: "))
        .or_else(|| error.strip_prefix("Messages request failed: "))
        .or_else(|| error.strip_prefix("Content generation request failed: "))
        .or_else(|| error.strip_prefix("Chat bridge request failed: "))
        .or_else(|| error.strip_prefix("Failed to create proxy HTTP client: "))?;
    Some(TransportFailure::classify(&detail.to_ascii_lowercase()))
}

/// Retry count appended by the transport layer, reported only when it retried.
fn transport_attempts(error: &str) -> Option<u64> {
    error
        .rsplit_once("(attempts: ")
        .and_then(|(_, count)| count.strip_suffix(')'))
        .and_then(|count| count.parse::<u64>().ok())
        .filter(|count| *count > 1)
}

pub(super) fn gui(error: &str) -> String {
    if let Some(known) = super::request_error::RequestError::decode(error) {
        return known.to_string();
    }
    if let Some(message) = super::request_error::catalog_message(error) {
        return message;
    }
    if crate::storage::interface_language() == crate::storage::InterfaceLanguage::Ru {
        return russian::gui(error);
    }
    if crate::storage::interface_language() == crate::storage::InterfaceLanguage::Ja {
        return japanese::gui(error);
    }
    chinese::gui(error)
}

fn diagnostic_fallback(error: &str) -> String {
    // Invalid typed envelopes are internal data, not human-readable failure messages.
    let detail =
        if error.starts_with("proxy_request_error:") || error.starts_with("proxy_catalog_error:") {
            chinese::INVALID_DETAIL.to_string()
        } else {
            crate::error_logs::sanitize_client_message(error)
        };
    chinese::diagnostic(&detail, &error_id(error))
}

/// Stable correlation with the detailed diagnostic entry without exposing its private contents.
pub(super) fn error_id(error: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(error.as_bytes())[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Fixed client-visible proxy texts produced outside `gui`, in the saved interface language.
/// The Chinese source stays the canonical value that tests and diagnostics compare.
pub(super) fn localized(source: &'static str) -> &'static str {
    if crate::storage::interface_language() == crate::storage::InterfaceLanguage::Ru {
        return russian::fixed(source).unwrap_or(source);
    }
    if crate::storage::interface_language() == crate::storage::InterfaceLanguage::Ja {
        return japanese::fixed(source).unwrap_or(source);
    }
    source
}

mod chinese;
mod japanese;
mod known;
mod russian;

#[cfg(test)]
#[path = "error_messages_tests.rs"]
mod tests;
