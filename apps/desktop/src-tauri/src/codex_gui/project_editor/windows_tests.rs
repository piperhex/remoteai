use super::*;

fn target(root: &Path, window: serde_json::Value) -> Target {
    serde_json::from_value(
        serde_json::json!({ "cwd": execution_path(root), "path": "large.txt", "window": window }),
    )
    .unwrap()
}

fn open(root: &Path) -> serde_json::Value {
    read(target(
        root,
        serde_json::json!({ "token": uuid::Uuid::new_v4(), "open": true }),
    ))
    .unwrap()
    .data
}

fn save_page(root: &Path, doc: &serde_json::Value, text: &str) -> Result<GuiResponse> {
    save(
        serde_json::from_value(serde_json::json!({
            "cwd": execution_path(root), "path": "large.txt", "window": doc["window"],
            "revision": doc["revision"], "text": text,
        }))
        .unwrap(),
    )
}

#[test]
fn pages_preserve_bom_multibyte_crlf_and_every_byte() {
    let root = tempfile::tempdir().unwrap();
    let source = format!("\u{feff}{}", "中文🙂\r\nline\n".repeat(70_000));
    fs::write(root.path().join("large.txt"), &source).unwrap();
    let mut doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap().to_owned();
    let mut actual = String::new();
    loop {
        let text = doc["text"].as_str().unwrap();
        assert!(text.len() <= PAGE_BYTES + 4);
        assert!(!text.ends_with('\r'));
        actual.push_str(text);
        let end = doc["window"]["end"].as_u64().unwrap();
        if end == source.len() as u64 {
            break;
        }
        doc = read(target(
            root.path(),
            serde_json::json!({ "token": token, "offset": end }),
        ))
        .unwrap()
        .data;
    }
    assert_eq!(actual, source);
    read(target(
        root.path(),
        serde_json::json!({ "token": token, "cancel": true }),
    ))
    .unwrap();
}

#[test]
fn page_save_preserves_prefix_suffix_and_rejects_external_changes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    let source = "中文🙂\r\n".repeat(80_000);
    fs::write(&path, &source).unwrap();
    let first = open(root.path());
    let token = first["window"]["token"].as_str().unwrap();
    let doc = read(target(
        root.path(),
        serde_json::json!({ "token": token, "offset": first["window"]["end"] }),
    ))
    .unwrap()
    .data;
    let start = doc["window"]["offset"].as_u64().unwrap() as usize;
    let end = doc["window"]["end"].as_u64().unwrap() as usize;
    let saved = save_page(root.path(), &doc, "changed\r\n🙂").unwrap().data;
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        format!("{}changed\r\n🙂{}", &source[..start], &source[end..])
    );
    assert_eq!(saved["text"], "changed\r\n🙂");
    fs::write(&path, "external").unwrap();
    assert!(matches!(
        save_page(root.path(), &saved, "lost"),
        Err(GuiError::ProjectFileConflict)
    ));
    assert_eq!(fs::read_to_string(path).unwrap(), "external");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    read(target(
        root.path(),
        serde_json::json!({ "token": token, "cancel": true }),
    ))
    .unwrap();
}

#[test]
fn immutable_pages_and_cancellation_remove_the_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    fs::write(&path, "a".repeat(INLINE_BYTES + 1)).unwrap();
    let doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap();
    let view = views().lock().unwrap().get(token).unwrap().clone();
    assert_eq!(
        view.snapshot
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .file
            .metadata()
            .unwrap()
            .len(),
        (INLINE_BYTES + 1) as u64
    );
    fs::write(&path, "b".repeat(INLINE_BYTES + 1)).unwrap();
    let page = read(target(
        root.path(),
        serde_json::json!({ "token": token, "offset": PAGE_BYTES }),
    ))
    .unwrap();
    assert!(page.data["text"]
        .as_str()
        .unwrap()
        .bytes()
        .all(|byte| byte == b'a'));
    read(target(
        root.path(),
        serde_json::json!({ "token": token, "cancel": true }),
    ))
    .unwrap();
    assert!(view.cancelled.load(Ordering::Relaxed));
    drop(view);
    assert!(!views().lock().unwrap().contains_key(token));
    assert!(matches!(
        read(target(root.path(), serde_json::json!({ "token": token }))),
        Err(GuiError::FileExpired)
    ));
}

#[test]
fn invalid_ranges_and_partial_codepoints_cannot_be_saved() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    let source = "🙂".repeat(INLINE_BYTES);
    fs::write(&path, &source).unwrap();
    let mut doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap().to_owned();
    for offset in [1, u64::MAX] {
        doc["window"]["offset"] = serde_json::json!(offset);
        assert!(matches!(
            save_page(root.path(), &doc, "x"),
            Err(GuiError::InvalidRequest)
        ));
    }
    assert!(read(target(
        root.path(),
        serde_json::json!({ "token": token, "offset": u64::MAX })
    ))
    .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), source);
}

#[test]
fn cancelled_capture_stops_and_invalid_utf8_is_not_editable() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    fs::write(&path, vec![b'x'; INLINE_BYTES + 1]).unwrap();
    assert!(matches!(
        capture(&path, &AtomicBool::new(true)),
        Err(GuiError::FileExpired)
    ));
    let mut bytes = vec![b'x'; INLINE_BYTES + 1];
    bytes[PAGE_BYTES - 1] = 0xf0;
    fs::write(&path, bytes).unwrap();
    assert!(matches!(
        capture(&path, &AtomicBool::new(false)),
        Err(GuiError::TextPreview)
    ));
}

#[test]
fn idle_expiry_drops_the_last_snapshot_owner() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("large.txt"), vec![b'a'; INLINE_BYTES + 1]).unwrap();
    let doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap();
    let weak = {
        let registry = views().lock().unwrap();
        let view = registry.get(token).unwrap();
        *view.touched.lock().unwrap() = Instant::now() - IDLE;
        Arc::downgrade(view)
    };
    prune();
    assert!(weak.upgrade().is_none());
    assert!(!views().lock().unwrap().contains_key(token));
}

#[test]
fn deleted_source_can_be_released_but_another_path_cannot_release_it() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    fs::write(&path, vec![b'a'; INLINE_BYTES + 1]).unwrap();
    let doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap();
    fs::remove_file(&path).unwrap();
    let mut wrong = target(
        root.path(),
        serde_json::json!({ "token": token, "cancel": true }),
    );
    wrong.path = "unrelated.txt".into();
    assert!(matches!(read(wrong), Err(GuiError::InvalidRequest)));
    read(target(
        root.path(),
        serde_json::json!({ "token": token, "cancel": true }),
    ))
    .unwrap();
    assert!(!views().lock().unwrap().contains_key(token));
}

#[test]
fn cancelling_a_waiting_save_keeps_the_original_and_cleans_staging() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.txt");
    let source = vec![b'a'; INLINE_BYTES + 1];
    fs::write(&path, &source).unwrap();
    let doc = open(root.path());
    let token = doc["window"]["token"].as_str().unwrap().to_owned();
    let guard = locks::acquire(&path.canonicalize().unwrap(), false).unwrap();
    let view = views().lock().unwrap().get(&token).unwrap().clone();
    std::thread::scope(|scope| {
        let saving = scope.spawn(|| save_page(root.path(), &doc, "replacement"));
        let deadline = Instant::now() + Duration::from_secs(2);
        while view.snapshot.try_lock().is_ok() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(matches!(
            view.snapshot.try_lock(),
            Err(std::sync::TryLockError::WouldBlock)
        ));
        read(target(
            root.path(),
            serde_json::json!({ "token": token, "cancel": true }),
        ))
        .unwrap();
        assert!(matches!(saving.join().unwrap(), Err(GuiError::FileExpired)));
    });
    drop(guard);
    assert_eq!(fs::read(&path).unwrap(), source);
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}
