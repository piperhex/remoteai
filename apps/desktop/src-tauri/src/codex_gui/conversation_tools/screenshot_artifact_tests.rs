use super::*;
use crate::codex_gui::{image_preview, image_thumbnail::ImageVariant};

fn capture() -> Value {
    let image = image::RgbImage::from_pixel(2, 2, image::Rgb([80, 120, 160]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Jpeg)
        .unwrap();
    json!({"threadId":"thread", "tabId":"tab", "result":{
        "url":"https://example.test/", "image":{
            "mimeType":"image/jpeg", "data":STANDARD.encode(bytes.into_inner())
        }
    }})
}

#[test]
fn screenshot_reply_retains_image_and_provides_one_durable_markdown_reference() {
    let root = tempfile::tempdir().unwrap();
    let original = capture();
    let saved = save(&root.path().join("images (with spaces)"), original.clone()).unwrap();
    let reference = &saved["result"]["screenshot"];
    let path = reference["path"].as_str().unwrap().to_owned();
    assert!(Path::new(&path).is_absolute());
    assert_eq!(reference["markdown"], format!("![](<{path}>)"));
    assert_eq!(
        fs::read(&path).unwrap(),
        STANDARD
            .decode(original["result"]["image"]["data"].as_str().unwrap())
            .unwrap()
    );
    let preview = image_preview::render_file(
        Path::new(&path),
        image_preview::PreviewOptions {
            variant: ImageVariant::Original,
            max_bytes: Some(2_000_000),
        },
    )
    .unwrap();
    assert_eq!(
        preview,
        format!(
            "data:image/jpeg;base64,{}",
            original["result"]["image"]["data"].as_str().unwrap()
        )
    );

    let reply = super::super::protocol::tool_result(Ok(saved));
    assert_eq!(reply["isError"], false);
    assert_eq!(reply["content"][1]["type"], "image");
    assert_eq!(
        reply["content"][1]["data"],
        original["result"]["image"]["data"]
    );
    let text: Value = serde_json::from_str(reply["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text["result"]["screenshot"]["path"], path);
    assert_eq!(text["result"]["url"], "https://example.test/");
    assert!(text["result"].get("image").is_none());
    assert_eq!(reply["structuredContent"], text);
}

#[test]
fn repeated_captures_do_not_overwrite_earlier_replies() {
    let root = tempfile::tempdir().unwrap();
    let first = save(root.path(), capture()).unwrap();
    let second = save(root.path(), capture()).unwrap();
    assert_ne!(
        first["result"]["screenshot"]["path"],
        second["result"]["screenshot"]["path"]
    );
    for saved in [first, second] {
        assert!(Path::new(saved["result"]["screenshot"]["path"].as_str().unwrap()).is_file());
    }
}

#[test]
fn malformed_or_oversized_captures_do_not_create_artifacts() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("captures");
    for image in [
        json!(null),
        json!({"mimeType":"image/jpeg", "data":""}),
        json!({"mimeType":"image/jpeg", "data":"!invalid!"}),
        json!({"mimeType":"image/jpeg", "data":STANDARD.encode(b"not an image")}),
        json!({"mimeType":"image/png", "data":capture()["result"]["image"]["data"]}),
        json!({"mimeType":"image/jpeg", "data":"A".repeat(MAX_ENCODED_BYTES + 1)}),
    ] {
        assert!(save(&directory, json!({"result":{"image":image}})).is_err());
    }
    assert!(!directory.exists());
}

#[test]
fn storage_failure_never_advertises_a_missing_image() {
    let root = tempfile::tempdir().unwrap();
    let blocked = root.path().join("file");
    fs::write(&blocked, b"existing").unwrap();
    let result = super::super::protocol::tool_result(save(&blocked, capture()));
    assert_eq!(result["isError"], true);
    assert_eq!(result["content"].as_array().unwrap().len(), 1);
    assert!(result["structuredContent"].get("result").is_none());
    assert_eq!(fs::read(blocked).unwrap(), b"existing");
}
