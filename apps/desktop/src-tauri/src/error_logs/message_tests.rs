use super::{database, message, models::*, tests::Fixture, worker::LogService};

const RELEASE_ERROR: &str = "Codex CLI [fetch release information]: HTTP status client error \
    (403 rate limit exceeded) for url (https://api.github.com/repos/openai/codex/releases/latest)";

#[test]
fn log_text_keeps_urls_paths_credentials_and_opaque_identifiers() {
    for input in [
        RELEASE_ERROR,
        "https://user:password@example.com/a?token=example-token&next=%2Fhome#detail",
        "path=\"C:\\Users\\Example User\\auth.json\"; '/home/example/auth.json'",
        "path=\"C:\\Users\\Example  User\\auth.json\"\r\ncaused by:\taccess denied",
        "'\\\\example-server\\folder\\auth.json'; file:///C:/example/auth.json",
        "Authorization: Bearer example-token; Basic dXNlcjpwYXNz",
        "Cookie: session=example-session; csrf=example-csrf",
        "Set-Cookie: session=example-session; HttpOnly",
        r#"{"api_key":"sk-example","password":"abc\"suffix","access_token":"eyJexample.jwt.signature"}"#,
        "request_id=0123456789abcdef0123456789abcdef",
    ] {
        assert_eq!(message::normalize(input).as_deref(), Some(input));
        assert_eq!(super::sanitize_diagnostic_message(input), input);
    }
}

#[test]
fn logs_still_bound_unicode_and_remove_control_characters_and_empty_entries() {
    assert_eq!(message::normalize(" \n\t "), None);
    assert_eq!(message::normalize("\0\u{7}"), None);
    assert_eq!(
        message::normalize(" \n 已保存\t 设置。\0 "),
        Some("已保存\t 设置。".to_owned())
    );
    let value = message::normalize(&"好".repeat(10_000)).unwrap();
    assert_eq!(value.chars().count(), message::MAX_MESSAGE_CHARS);
}

#[test]
fn every_log_source_preserves_values_after_persistence_reopening_and_serialization() {
    let fixture = Fixture::new();
    let service = LogService::start(fixture.database_path()).unwrap();
    let proxy = "upstream failed: https://example.com/responses?token=example-token";
    let toast = "saved to C:\\Users\\Example\\auth.json; api_key=sk-example";
    service.record_codex(RELEASE_ERROR);
    service.record_proxy(proxy, Some(502));
    service.record_toast(toast).unwrap();
    let query = || ListQuery::new(Some(10), None, None).unwrap();
    let before = service.list(query()).unwrap();
    service.shutdown_for_test().unwrap();
    let reopened = database::open(&fixture.database_path()).unwrap();
    let after = database::list(&reopened, query()).unwrap();
    assert_eq!(
        serde_json::to_value(&before).unwrap(),
        serde_json::to_value(&after).unwrap()
    );
    let serialized = serde_json::to_value(after).unwrap();
    for (index, (source, expected)) in
        [("toast", toast), ("proxy", proxy), ("codex", RELEASE_ERROR)]
            .into_iter()
            .enumerate()
    {
        assert_eq!(serialized["entries"][index]["source"], source);
        assert_eq!(serialized["entries"][index]["message"], expected);
    }
}
