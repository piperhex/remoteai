use serde_json::Value;

use crate::models::CreditsSnapshot;

pub(super) fn parse_credits(value: Option<&Value>) -> Option<CreditsSnapshot> {
    let value = value?.as_object()?;
    Some(CreditsSnapshot {
        has_credits: value.get("has_credits")?.as_bool()?,
        unlimited: value.get("unlimited")?.as_bool()?,
        balance: value.get("balance").and_then(parse_balance),
    })
}

fn parse_balance(value: &Value) -> Option<String> {
    let balance = match value {
        Value::String(value) => value.trim().to_owned(),
        Value::Number(value) => value.to_string(),
        _ => return None,
    };
    balance
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|_| balance)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{codex_api::parse_usage, models::UsageSummary};
    use serde_json::json;

    #[test]
    fn reads_credits_with_usage_and_preserves_them_in_cache() {
        let usage = parse_usage(&json!({
            "credits": { "has_credits": true, "unlimited": false, "balance": "62500.25" },
            "rate_limit": { "primary_window": { "used_percent": 25 } }
        }));
        let restored: UsageSummary =
            serde_json::from_value(serde_json::to_value(&usage).unwrap()).unwrap();
        assert_eq!(usage.credits, restored.credits);
        assert_eq!(
            restored.credits.unwrap().balance.as_deref(),
            Some("62500.25")
        );
        assert_eq!(restored.primary.unwrap().remaining_percent, 75.0);
    }

    #[test]
    fn distinguishes_zero_unlimited_and_unknown_credits() {
        for balance in [json!(0), json!("0"), json!(62500), json!("62500")] {
            let credits = parse_credits(Some(&json!({
                "has_credits": true, "unlimited": false, "balance": balance
            })))
            .unwrap();
            assert!(credits.balance.is_some());
        }
        let unlimited =
            parse_credits(Some(&json!({ "has_credits": true, "unlimited": true }))).unwrap();
        assert!(unlimited.unlimited);
        assert_eq!(unlimited.balance, None);
        assert_eq!(parse_usage(&json!({})).credits, None);
        assert_eq!(parse_usage(&json!({ "credits": null })).credits, None);
        assert_eq!(parse_usage(&json!({ "credits": {} })).credits, None);
        assert_eq!(
            serde_json::from_value::<UsageSummary>(json!({}))
                .unwrap()
                .credits,
            None
        );
    }

    #[test]
    fn invalid_balance_does_not_break_usage_or_look_like_zero() {
        for balance in [
            json!(""),
            json!("NaN"),
            json!("inf"),
            json!(-1),
            json!({}),
            Value::Null,
        ] {
            let usage = parse_usage(&json!({
                "credits": { "has_credits": true, "unlimited": false, "balance": balance },
                "rate_limit": { "primary_window": { "used_percent": 10 } }
            }));
            assert_eq!(usage.credits.unwrap().balance, None);
            assert_eq!(usage.primary.unwrap().remaining_percent, 90.0);
            assert_eq!(usage.error, None);
        }
    }
}
