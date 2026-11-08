use super::*;
use crate::codex_gui::title_generation::MAX_PROMPT_CHARS;

fn mutation(title: Option<&str>) -> Mutation {
    Mutation::Create(protocol::Create {
        request_id: "create-title".into(),
        message: "补充要求".into(),
        cwd: None,
        title: title.map(str::to_owned),
        model: None,
        effort: None,
        caller: Some(selection()),
    })
}

fn parse(title: Value) -> Result<protocol::Tool> {
    protocol::parse(&json!({"name":"gui_create_conversation", "arguments":{
        "requestId":"create-title", "message":"hello", "title":title,
    }}))
}

#[test]
fn title_is_optional_bounded_unicode_text_without_control_characters() {
    assert!(mutation(None).validate().is_ok());
    for title in [
        " 部署上线 ".into(),
        "中".repeat(protocol::MAX_TITLE_CHARACTERS),
    ] {
        assert!(parse(json!(title)).is_ok());
    }
    for title in [
        json!(""),
        json!(" \u{3000} "),
        json!("title\nbody"),
        json!("title\0"),
        json!("中".repeat(protocol::MAX_TITLE_CHARACTERS + 1)),
        json!(42),
    ] {
        assert!(parse(title).is_err());
    }
    let tools = protocol::tools().unwrap();
    let schema = &tools["tools"][0]["inputSchema"];
    assert_eq!(
        schema["properties"]["title"]["maxLength"],
        protocol::MAX_TITLE_CHARACTERS
    );
    assert_eq!(schema["required"], json!(["requestId", "message"]));
}

#[tokio::test]
async fn preparation_trims_explicit_titles_without_changing_the_first_message() {
    let root = tempfile::tempdir().unwrap();
    let Mutation::Create(args) = mutation(Some(" 部署上线 ")) else {
        panic!("not create")
    };
    let prepared = operations::prepare_create(root.path().canonicalize().unwrap(), args)
        .await
        .unwrap();
    assert_eq!(prepared.title.as_deref(), Some("部署上线"));
    assert_eq!(prepared.message, "补充要求");
}

#[tokio::test]
async fn explicit_title_is_saved_before_sending_without_model_naming() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = mutation(Some("部署上线"));
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    let fake = Fake(Mutex::new(VecDeque::from([
        ("thread/start", json!({}), Ok(thread(false))),
        saved_model(),
        (
            "thread/name/set",
            json!({"threadId":"target", "name":"部署上线"}),
            Ok(json!({})),
        ),
        (
            "turn/start",
            creation_prompt(),
            Ok(json!({"turn":{"id":"created-turn"}})),
        ),
    ])));
    let mut prepared = prepared(json!({}));
    prepared.title = Some("部署上线".into());
    let receipt = operations::create(&fake, prepared, &mut entry)
        .await
        .unwrap();
    assert_eq!(receipt["status"], "sent");
    let Claim::Existing(saved) = Journal::default()
        .claim(root.path(), &mutation)
        .await
        .unwrap()
    else {
        panic!("replayed")
    };
    assert_eq!(saved, receipt);
    assert!(fake.0.lock().await.is_empty());
}

#[tokio::test]
async fn failed_explicit_title_does_not_send_or_fall_back_to_model_naming() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = mutation(Some("部署上线"));
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    let fake = Fake(Mutex::new(VecDeque::from([
        ("thread/start", json!({}), Ok(thread(false))),
        saved_model(),
        (
            "thread/name/set",
            json!({"threadId":"target", "name":"部署上线"}),
            Err(Error::Unavailable),
        ),
    ])));
    let mut prepared = prepared(json!({}));
    prepared.title = Some("部署上线".into());
    assert!(operations::create(&fake, prepared, &mut entry)
        .await
        .is_err());
    let Claim::Existing(receipt) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("replayed")
    };
    assert_eq!(receipt["status"], "unknown");
    assert_eq!(receipt["threadId"], "target");
    assert!(fake.0.lock().await.is_empty());
}

#[tokio::test]
async fn omitted_title_schedules_bounded_model_naming_after_the_first_send() {
    let root = tempfile::tempdir().unwrap();
    let Claim::New(mut entry) = Journal::default()
        .claim(root.path(), &mutation(None))
        .await
        .unwrap()
    else {
        panic!("not new")
    };
    let mut prepared = prepared(json!({}));
    prepared.message = format!("  {}  ", "中".repeat(MAX_PROMPT_CHARS + 1));
    let mut message = creation_prompt();
    message["input"][0]["text"] = json!(prepared.message);
    let fake = Fake(Mutex::new(VecDeque::from([
        ("thread/start", json!({}), Ok(thread(false))),
        saved_model(),
        (
            "turn/start",
            message,
            Ok(json!({"turn":{"id":"created-turn"}})),
        ),
        (
            "generate/title",
            json!({"threadId":"target", "prompt":"中".repeat(MAX_PROMPT_CHARS)}),
            Ok(json!({})),
        ),
    ])));
    assert_eq!(
        operations::create(&fake, prepared, &mut entry)
            .await
            .unwrap()["status"],
        "sent"
    );
    assert!(fake.0.lock().await.is_empty());
}

#[tokio::test]
async fn changing_only_the_title_conflicts_instead_of_replaying_the_creation() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    journal
        .claim(root.path(), &mutation(Some("部署上线")))
        .await
        .unwrap();
    for title in [None, Some("检查部署")] {
        assert!(matches!(
            journal.claim(root.path(), &mutation(title)).await,
            Err(Error::RequestConflict)
        ));
    }
}
