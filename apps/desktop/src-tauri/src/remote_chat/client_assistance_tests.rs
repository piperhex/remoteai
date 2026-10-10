use super::*;

#[test]
fn assistance_authentication_uses_native_helper_identity_and_the_invited_host() {
    let invitation = uuid::Uuid::new_v4().to_string();
    let request: OpenRequest = serde_json::from_value(serde_json::json!({
        "clientId": uuid::Uuid::new_v4(), "deviceId": "invited-host",
        "identity": {"userId": "helper", "baseUrl": "https://example.test"},
        "publicKey": "ab".repeat(32), "assistanceId": invitation,
        "assistingDeviceId": "untrusted-device"
    }))
    .unwrap();
    let config = Config {
        websocket_url: "wss://example.test/device-chat".into(),
        owner: "\"helper\"".into(),
        device_id: "actual-helper-pc".into(),
        access_token: "native-only-token".into(),
    };
    assert!(request.validate());
    assert!(request.matches(&config));
    let frame = authentication_message(&request, &config, false);
    assert_eq!(frame["deviceId"], "invited-host");
    assert_eq!(frame["assistingDeviceId"], "actual-helper-pc");
    assert_eq!(frame["assistanceId"], invitation);
    assert_eq!(frame["accessToken"], "native-only-token");
}
