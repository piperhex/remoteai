use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::OWNER_PREFIX;

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Identity {
    pub(super) account: String,
    pub(super) scope: String,
}

impl Identity {
    pub(super) fn from_auth(auth: &Value) -> Option<Self> {
        // Do not guess identities for API keys, agent identities or opaque tokens.
        let tokens = auth.get("tokens")?;
        let token = tokens.get("id_token")?.as_str()?;
        let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
        let claims: Value = serde_json::from_slice(&payload).ok()?;
        let nested = claims.get("https://api.openai.com/auth")?;
        let user =
            nonempty(nested.get("chatgpt_user_id")).or_else(|| nonempty(nested.get("user_id")))?;
        let account = nonempty(tokens.get("account_id"))
            .or_else(|| nonempty(nested.get("chatgpt_account_id")))?;
        // Codex desktop 26.1120 hashes the compact JSON pair, not Remote AI's account ID.
        let owner = hex::encode(Sha256::digest(
            json!([user, account]).to_string().as_bytes(),
        ));
        Some(Self {
            account: account.to_string(),
            scope: format!("{OWNER_PREFIX}{owner}"),
        })
    }
}

fn nonempty(value: Option<&Value>) -> Option<&str> {
    value?.as_str().filter(|value| !value.trim().is_empty())
}
