use crate::bridge_call;
use serde_json::{json, Value};

fn call(owner: &str, scope: &str, request: Value) -> Value {
    serde_json::from_str(&bridge_call(
        &json!({ "owner": owner, "scope": scope, "request": request }).to_string(),
    ))
    .expect("JSON response")
}

#[test]
fn validates_requests_and_keeps_scopes_separate() {
    assert!(call("test", "one", json!({ "type": "list" }))["data"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        call(
            "test",
            "one",
            json!({ "type": "probe", "endpoint": { "host": "bad/host", "port": 22 } })
        )["error"],
        "client.ssh.invalid"
    );
    assert_eq!(
        call(
            "test",
            "other",
            json!({ "type": "files", "id": "ssh-other-owner",
        "request": { "type": "list", "path": "." } })
        )["error"],
        "client.ssh.closed"
    );
    assert!(call("test", "one", json!({ "type": "dispose" }))["data"].is_null());
    assert!(call("test", "other", json!({ "type": "list" }))["data"]
        .as_array()
        .unwrap()
        .is_empty());
    call("test", "other", json!({ "type": "dispose" }));
}
