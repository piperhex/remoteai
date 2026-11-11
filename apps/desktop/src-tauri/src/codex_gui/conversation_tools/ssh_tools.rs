use super::{protocol, Error, Result};
use csw_ssh_client::ExecutionOptions;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profiles {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Execute {
    profile_id: String,
    revision: u64,
    command: String,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    30
}

pub(super) async fn execute(app: AppHandle, params: Value) -> Result<Value> {
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if params["name"] == "gui_ssh_terminal" {
        let request = terminal_request(arguments, &params)?;
        return Ok(crate::cloud::agent_ssh_terminal(app, request)
            .await
            .unwrap_or_else(|error| json!({"error":error.to_string()})));
    }
    if params["name"] == "gui_ssh_profiles" {
        let _: Profiles = serde_json::from_value(arguments)?;
        return tauri::async_runtime::spawn_blocking(move || {
            crate::cloud::agent_ssh_profiles(&app)
                .map(|profiles| json!({ "profiles": profiles }))
                .unwrap_or_else(|error| json!({ "error": error.to_string() }))
        })
        .await
        .map_err(|_| Error::Unavailable);
    }
    let args: Execute = serde_json::from_value(arguments)?;
    protocol::identifier(&args.profile_id)?;
    if args.revision == 0 {
        return Err(Error::Invalid);
    }
    let options = ExecutionOptions {
        command: args.command,
        timeout_seconds: args.timeout_seconds,
    };
    options.validate()?;
    match crate::cloud::agent_ssh_execute(app, args.profile_id, args.revision, options).await {
        Ok(output) => Ok(serde_json::to_value(output)?),
        Err(error) => Ok(json!({ "error": error.to_string() })),
    }
}

fn terminal_request(arguments: Value, params: &Value) -> Result<crate::cloud::TerminalRequest> {
    let request: crate::cloud::TerminalRequest = serde_json::from_value(arguments)?;
    if params["_meta"]["x-codex-turn-metadata"]["thread_id"]
        .as_str()
        .is_some_and(|thread| thread != request.owner().0)
    {
        return Err(Error::Invalid);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_rejects_another_conversations_thread_before_dispatch() {
        let params = json!({"_meta":{"x-codex-turn-metadata":{"thread_id":"owner"}}});
        let arguments = json!({"action":"read", "threadId":"other", "sessionId":"saved"});
        assert!(matches!(
            terminal_request(arguments, &params),
            Err(Error::Invalid)
        ));
        let arguments = json!({"action":"read", "threadId":"owner", "sessionId":"saved"});
        assert!(terminal_request(arguments.clone(), &params).is_ok());
        // Older callers omit turn metadata; the host still enforces the session's saved owner.
        assert!(terminal_request(arguments, &json!({})).is_ok());
    }
}
