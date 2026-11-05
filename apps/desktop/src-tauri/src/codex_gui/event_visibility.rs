//! Keep background execution observable without copying its message bodies into a renderer.
use serde_json::Value;
use std::collections::HashSet;

pub(super) fn thread_id(event: &Value) -> Option<&str> {
    event["params"]["threadId"]
        .as_str()
        .or_else(|| event["params"]["thread"]["id"].as_str())
}

pub(super) fn filter(mut event: Value, viewed: &HashSet<String>) -> Option<Value> {
    if !event["id"].is_null() || thread_id(&event).is_none_or(|id| viewed.contains(id)) {
        return Some(event);
    }
    let method = event["method"].as_str().unwrap_or_default();
    if (method.starts_with("item/") && !matches!(method, "item/started" | "item/completed"))
        || matches!(method, "turn/diff/updated" | "turn/plan/updated")
    {
        return None;
    }
    let params = &mut event["params"];
    if let Some(item) = params["item"].as_object_mut() {
        item.retain(|key, _| matches!(key.as_str(), "id" | "type" | "status" | "exitCode"));
    }
    if let Some(turn) = params["turn"].as_object_mut() {
        turn.remove("items");
        turn.remove("diff");
        turn.remove("plan");
        turn.remove("planExplanation");
    }
    if let Some(thread) = params["thread"].as_object_mut() {
        thread.remove("turns");
    }
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn background_content_never_reaches_the_renderer() {
        let viewed = HashSet::from(["open".into()]);
        for method in [
            "item/agentMessage/delta",
            "item/commandExecution/outputDelta",
            "turn/diff/updated",
        ] {
            let event = json!({"method":method,"params":{"threadId":"closed","delta":"x".repeat(1_000_000)}});
            assert!(filter(event.clone(), &viewed).is_none());
            let mut open = event;
            open["params"]["threadId"] = json!("open");
            assert_eq!(filter(open.clone(), &viewed), Some(open));
        }
        let event = json!({"method":"item/completed","params":{"threadId":"closed",
            "item":{"id":"i","type":"commandExecution","status":"completed","aggregatedOutput":"large"}}});
        let filtered = filter(event, &viewed).unwrap();
        assert_eq!(
            filtered["params"]["item"],
            json!({"id":"i","type":"commandExecution","status":"completed"})
        );
    }

    #[test]
    fn approvals_and_completion_survive_without_full_history() {
        let viewed = HashSet::new();
        let approval = json!({"id":7,"method":"item/tool/requestUserInput",
            "params":{"threadId":"closed","questions":[{"question":"Choose"}]}});
        assert_eq!(filter(approval.clone(), &viewed), Some(approval));
        let event = json!({"method":"turn/completed","params":{"threadId":"closed",
            "turn":{"id":"t","status":"failed","error":{"message":"capacity"},"items":[{"text":"large"}]}}});
        let filtered = filter(event, &viewed).unwrap();
        assert_eq!(filtered["params"]["turn"]["status"], "failed");
        assert!(filtered["params"]["turn"]["items"].is_null());
        assert_eq!(filtered["params"]["turn"]["error"]["message"], "capacity");
    }
}
