use chrono::{DateTime, NaiveDate, Utc};
use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};

mod credits;

use crate::{
    auth::{account_fields, decode_jwt, token_string},
    models::{ResetCredit, ResetCreditsSummary, UsageSummary, UsageWindow},
    providers::DEFAULT_OFFICIAL_MODEL,
};

pub(crate) const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub(crate) const ISSUER: &str = "https://auth.openai.com";
pub(crate) const ORIGINATOR: &str = "codex_cli_rs";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const RESET_CREDIT_CONSUME_URL: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";
const RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
pub(crate) const QUOTA_CONSUMPTION_PROMPT: &str = "今天天气如何？";

pub(crate) fn token_expiring(auth: &Value) -> bool {
    let Some(token) = token_string(auth, "access_token") else {
        return true;
    };
    let Ok(claims) = decode_jwt(token) else {
        return false;
    };
    let Some(exp) = claims.get("exp").and_then(Value::as_i64) else {
        return false;
    };
    exp <= Utc::now().timestamp() + 300
}

pub(crate) fn refresh_tokens(client: &Client, auth: &mut Value) -> Result<(), String> {
    let refresh_token = token_string(auth, "refresh_token")
        .ok_or_else(|| "登录已过期，且 auth.json 中没有 refresh_token；请重新登录".to_string())?
        .to_string();
    let response = client
        .post(format!("{ISSUER}/oauth/token"))
        .header("Content-Type", "application/json")
        .header("originator", ORIGINATOR)
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| format!("刷新登录凭据失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "刷新登录凭据失败（HTTP {}），请重新登录",
            response.status()
        ));
    }
    let payload: Value = response
        .json()
        .map_err(|error| format!("解析刷新响应失败：{error}"))?;
    apply_refreshed_tokens(auth, &payload, Utc::now())
}

fn apply_refreshed_tokens(
    auth: &mut Value,
    payload: &Value,
    refreshed_at: chrono::DateTime<Utc>,
) -> Result<(), String> {
    let tokens = auth
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "auth.json 缺少 tokens 对象".to_string())?;
    for key in ["id_token", "access_token", "refresh_token"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            tokens.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    auth.as_object_mut()
        .ok_or_else(|| "auth.json 顶层格式无效".to_string())?
        .insert(
            "last_refresh".to_string(),
            Value::String(refreshed_at.to_rfc3339()),
        );
    Ok(())
}

pub(crate) fn usage_request(client: &Client, auth: &Value) -> Result<Response, String> {
    authorized_get(client, auth, USAGE_URL, "读取 Codex 用量失败")
}

pub(crate) fn reset_credits_request(client: &Client, auth: &Value) -> Result<Response, String> {
    authorized_get(client, auth, RESET_CREDITS_URL, "读取 Codex 重置卡失败")
}

pub(crate) fn consume_reset_credit_request(
    client: &Client,
    auth: &Value,
    redeem_request_id: &str,
) -> Result<Response, String> {
    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    let mut request = client
        .post(RESET_CREDIT_CONSUME_URL)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0")
        .header("Content-Type", "application/json")
        .json(&json!({ "redeem_request_id": redeem_request_id }));
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .map_err(|error| format!("使用 Codex 重置卡失败：{error}"))
}

pub(crate) fn quota_consumption_request(
    client: &Client,
    authorization: &str,
    account_id: Option<&str>,
    is_fedramp: bool,
) -> Result<Response, String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let mut request = client
        .post(RESPONSES_URL)
        .header("Authorization", authorization)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0")
        .header("Accept", "text/event-stream")
        .header("session-id", &conversation_id)
        .header("thread-id", &conversation_id)
        .header("x-openai-internal-codex-responses-lite", "true")
        .json(&quota_consumption_body());
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    if is_fedramp {
        request = request.header("x-openai-fedramp", "true");
    }
    request
        .send()
        .map_err(|error| format!("发送 Codex 对话失败：{error}"))
}

fn quota_consumption_body() -> Value {
    json!({
        "model": DEFAULT_OFFICIAL_MODEL,
        "instructions": "",
        "input": [
            {
                "type": "additional_tools",
                "role": "developer",
                "tools": []
            },
            {
                "type": "message",
                "role": "developer",
                "content": [{
                    "type": "input_text",
                    "text": "Answer the user's question briefly."
                }]
            },
            {
                "type": "message",
                "role": "user",
                "content": [{
                    "type": "input_text",
                    "text": QUOTA_CONSUMPTION_PROMPT
                }]
            }
        ],
        "tool_choice": "auto",
        "parallel_tool_calls": false,
        "reasoning": {
            "effort": "low",
            "context": "all_turns"
        },
        "store": false,
        "stream": true,
        "include": ["reasoning.encrypted_content"],
        "text": { "verbosity": "low" }
    })
}

pub(crate) fn quota_consumption_response_completed(body: &str) -> bool {
    body.lines()
        .filter_map(|line| line.trim().strip_prefix("data:"))
        .map(str::trim)
        .filter(|data| !data.is_empty() && *data != "[DONE]")
        .filter_map(|data| serde_json::from_str::<Value>(data).ok())
        .any(|event| event.get("type").and_then(Value::as_str) == Some("response.completed"))
}

fn authorized_get(
    client: &Client,
    auth: &Value,
    url: &str,
    error_context: &str,
) -> Result<Response, String> {
    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    let mut request = client
        .get(url)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .map_err(|error| format!("{error_context}：{error}"))
}

fn normalized_timestamp(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(timestamp) = value.as_str() {
        if let Ok(value) = DateTime::parse_from_rfc3339(timestamp) {
            return Some(value.with_timezone(&Utc).to_rfc3339());
        }
        return NaiveDate::parse_from_str(timestamp, "%Y-%m-%d")
            .ok()?
            .and_hms_opt(0, 0, 0)
            .map(|value| value.and_utc().to_rfc3339());
    }

    let raw = value.as_i64()?;
    let seconds = if raw.abs() >= 100_000_000_000 {
        raw / 1000
    } else {
        raw
    };
    chrono::DateTime::<Utc>::from_timestamp(seconds, 0).map(|value| value.to_rfc3339())
}

pub(crate) fn parse_reset_credits(payload: &Value) -> Result<ResetCreditsSummary, String> {
    let credits = payload
        .get("credits")
        .and_then(Value::as_array)
        .ok_or_else(|| "重置卡接口响应缺少 credits 列表".to_string())?;
    let mut result = credits
        .iter()
        .map(|credit| ResetCredit {
            issued_at: normalized_timestamp(
                credit
                    .get("granted_at")
                    .or_else(|| credit.get("created_at")),
            ),
            expires_at: normalized_timestamp(credit.get("expires_at")),
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| left.expires_at.cmp(&right.expires_at));
    Ok(ResetCreditsSummary { credits: result })
}

fn window_from(value: Option<&Value>) -> Option<UsageWindow> {
    let value = value?;
    let used = value.get("used_percent")?.as_f64()?.clamp(0.0, 100.0);
    Some(UsageWindow {
        used_percent: used,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        resets_at: value.get("reset_at").and_then(Value::as_i64),
        window_minutes: value
            .get("limit_window_seconds")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .map(|seconds| seconds / 60),
    })
}

pub(crate) fn parse_usage(payload: &Value) -> UsageSummary {
    let rate_limit = payload.get("rate_limit").filter(|value| !value.is_null());
    let primary_value = rate_limit.and_then(|value| value.get("primary_window"));
    let secondary_value = rate_limit.and_then(|value| value.get("secondary_window"));
    let primary = window_from(primary_value);
    let secondary = window_from(secondary_value);
    // An invalid reported window must not look like a valid single-window account
    // when automatic reset checks whether it is allowed to spend a card.
    let invalid_window = [(primary_value, &primary), (secondary_value, &secondary)]
        .into_iter()
        .any(|(value, window)| value.is_some_and(|value| !value.is_null()) && window.is_none());
    UsageSummary {
        primary,
        secondary,
        credits: credits::parse_credits(payload.get("credits")),
        api_expires_at: None,
        plan: payload
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        fetched_at: Some(Utc::now().to_rfc3339()),
        error: invalid_window.then(|| "用量信息不完整，请刷新后重试".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn maps_used_quota_to_remaining_quota() {
        let usage = parse_usage(&json!({
            "plan_type": "pro",
            "promo": {
                "details": {
                    "valid_until": "2026-08-31T12:30:00Z",
                    "ends_at": "2026-09-30T12:30:00Z"
                }
            },
            "rate_limit": {
                "primary_window": { "used_percent": 42, "limit_window_seconds": 18000, "reset_at": 123 },
                "secondary_window": { "used_percent": 5, "limit_window_seconds": 604800, "reset_at": 456 }
            }
        }));
        assert_eq!(usage.plan.as_deref(), Some("pro"));
        assert_eq!(usage.api_expires_at, None);
        assert_eq!(usage.primary.unwrap().remaining_percent, 58.0);
        assert_eq!(usage.secondary.unwrap().window_minutes, Some(10080));
    }

    #[test]
    fn ignores_expiration_fields_outside_promo_and_clears_null_promo() {
        let usage = parse_usage(&json!({
            "plan_type": "",
            "expires_at": "2026-01-01T00:00:00Z",
            "promo": null
        }));
        assert_eq!(usage.api_expires_at, None);
        assert_eq!(usage.plan, None);
    }

    #[test]
    fn refreshed_tokens_update_last_refresh() {
        let mut auth = json!({
            "tokens": {
                "id_token": "old-id",
                "access_token": "old-access",
                "refresh_token": "old-refresh"
            },
            "last_refresh": "2025-01-01T00:00:00Z"
        });
        let refreshed_at = Utc.with_ymd_and_hms(2026, 7, 21, 1, 2, 3).unwrap();

        apply_refreshed_tokens(
            &mut auth,
            &json!({
                "id_token": "new-id",
                "access_token": "new-access",
                "refresh_token": "new-refresh"
            }),
            refreshed_at,
        )
        .unwrap();

        assert_eq!(auth["tokens"]["access_token"], "new-access");
        assert_eq!(auth["tokens"]["refresh_token"], "new-refresh");
        assert_eq!(auth["last_refresh"], "2026-07-21T01:02:03+00:00");
    }

    #[test]
    fn returns_only_reset_credit_times() {
        let summary = parse_reset_credits(&json!({
            "available_count": 1,
            "credits": [{
                "credit_id": "must-not-leave-rust",
                "status": "available",
                "granted_at": "2026-06-30T03:04:05Z",
                "expires_at": "2026-07-30T03:04:05Z"
            }]
        }))
        .unwrap();
        let serialized = serde_json::to_value(summary).unwrap();
        assert_eq!(
            serialized["credits"][0]["issuedAt"],
            "2026-06-30T03:04:05+00:00"
        );
        assert_eq!(
            serialized["credits"][0]["expiresAt"],
            "2026-07-30T03:04:05+00:00"
        );
        assert!(serialized.to_string().find("must-not-leave-rust").is_none());
    }

    #[test]
    fn quota_consumption_body_matches_current_codex_responses_shape() {
        let body = quota_consumption_body();

        assert_eq!(body["model"], DEFAULT_OFFICIAL_MODEL);
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["reasoning"]["effort"], "low");
        assert_eq!(body["reasoning"]["context"], "all_turns");
        assert_eq!(body["input"][0]["type"], "additional_tools");
        assert_eq!(body["input"][2]["role"], "user");
        assert_eq!(
            body["input"][2]["content"][0]["text"],
            QUOTA_CONSUMPTION_PROMPT
        );
    }

    #[test]
    fn recognizes_a_completed_quota_consumption_stream() {
        let stream = concat!(
            "event: response.created\n",
            "data: {\"type\":\"response.created\"}\n\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp-1\"}}\n\n",
            "data: [DONE]\n\n"
        );

        assert!(quota_consumption_response_completed(stream));
        assert!(!quota_consumption_response_completed(
            "data: {\"type\":\"response.failed\"}\n\n"
        ));
    }
}
