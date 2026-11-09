//! Match Codex's proactive expiry check and its fallback for opaque access tokens.
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;

use crate::auth::{decode_jwt, token_string};

const ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 5;
const FALLBACK_REFRESH_INTERVAL_DAYS: i64 = 8;

pub(crate) fn token_expiring(auth: &Value) -> bool {
    token_expiring_at(auth, Utc::now())
}

fn token_expiring_at(auth: &Value, now: DateTime<Utc>) -> bool {
    let Some(token) = token_string(auth, "access_token") else {
        return true;
    };
    let expiration = decode_jwt(token)
        .ok()
        .and_then(|claims| claims.get("exp").and_then(Value::as_i64))
        .and_then(|seconds| DateTime::<Utc>::from_timestamp(seconds, 0));
    if let Some(expiration) = expiration {
        return expiration <= now + Duration::minutes(ACCESS_TOKEN_REFRESH_WINDOW_MINUTES);
    }
    auth.get("last_refresh")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|last| last < now - Duration::days(FALLBACK_REFRESH_INTERVAL_DAYS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;

    #[test]
    fn access_expiry_takes_precedence_over_the_fallback_interval() {
        let now = DateTime::parse_from_rfc3339("2026-11-09T00:00:00Z")
            .unwrap()
            .to_utc();
        for (seconds, expected) in [(-1, true), (299, true), (300, true), (301, false)] {
            let claims = json!({"exp": now.timestamp() + seconds});
            let token = format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()));
            let auth =
                json!({"tokens": {"access_token": token}, "last_refresh": "2025-01-01T00:00:00Z"});
            assert_eq!(token_expiring_at(&auth, now), expected, "{seconds}");
        }
    }

    #[test]
    fn unreadable_expiry_uses_last_refresh_without_inventing_an_expiry() {
        let now = DateTime::parse_from_rfc3339("2026-11-09T00:00:00Z")
            .unwrap()
            .to_utc();
        for claims in [
            json!({}),
            json!({"exp": "invalid"}),
            json!({"exp": i64::MAX}),
        ] {
            let token = format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()));
            for token in [token.as_str(), "opaque-access"] {
                for (last, expected) in [
                    (json!("2026-10-31T23:59:59Z"), true),
                    (json!("2026-11-01T00:00:00Z"), false),
                    (json!("2026-11-08T00:00:00Z"), false),
                    (json!("invalid"), false),
                    (Value::Null, false),
                ] {
                    let auth = json!({"tokens": {"access_token": token}, "last_refresh": last});
                    assert_eq!(token_expiring_at(&auth, now), expected, "{auth}");
                }
            }
        }
        assert!(token_expiring_at(&json!({"tokens": {}}), now));
    }
}
