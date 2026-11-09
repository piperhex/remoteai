use super::error::{GuiError, Result};
use serde_json::Value;

pub(super) const PREFIX: &str = "ssh-profile://";

pub(super) fn reference_id(path: &str) -> Result<&str> {
    let id = path.strip_prefix(PREFIX).ok_or(GuiError::InvalidRequest)?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(id)
}

/// References carry only an ID; the authenticated tool resolves current metadata and credentials.
pub(super) fn inputs(path: &str, name: &str) -> Result<Vec<Value>> {
    Ok(vec![super::conversation_context::ssh(
        reference_id(path)?,
        name,
    )?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn references_survive_send_steering_queue_and_display_without_credentials() {
        let attachment =
            json!({"kind":"ssh", "name":"开发服务器", "path":"ssh-profile://development"});
        let message = json!({"text":"检查磁盘", "images":[], "attachments":[attachment]});
        for operation in ["send", "steer", "sendBatch"] {
            let mut request = message.clone();
            request["operation"] = json!(operation);
            request["threadId"] = json!("one");
            request["turnId"] = json!("turn");
            request["messages"] = json!([message]);
            let (_, params) = serde_json::from_value::<super::super::protocol::GuiRequest>(request)
                .unwrap()
                .into_rpc()
                .unwrap();
            let context = params["input"][1]["text"].as_str().unwrap();
            assert!(context.contains("gui_ssh_execute") && context.contains("development"));
            let mut display = json!({"type":"userMessage", "content":params["input"]});
            super::super::conversation_context::display(&mut display);
            assert_eq!(
                display["content"][1],
                json!({"type":"mention", "name":"开发服务器",
                "path":"ssh-profile://development"})
            );
        }
    }

    #[test]
    fn rejects_paths_control_characters_and_unbounded_identifiers() {
        for path in [
            "ssh-profile://../secret",
            "ssh-profile://",
            "ssh-profile://name?revision=1",
            "ssh-profile://name\n",
            "https://example.com",
        ] {
            assert!(inputs(path, "name").is_err());
        }
        assert!(inputs(&format!("ssh-profile://{}", "a".repeat(129)), "name").is_err());
    }
}
