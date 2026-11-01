use super::*;

fn project() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn target(root: &Path, path: &str) -> Target {
    Target {
        cwd: execution_path(root),
        path: path.to_owned(),
        chunk: None,
        window: None,
    }
}

#[test]
fn saves_utf8_and_line_endings_without_overwriting_an_external_edit() {
    let root = project();
    let path = root.path().join("sample.ts");
    let original = "\u{feff}const 你好 = 1;\r\n";
    fs::write(&path, original).unwrap();
    let before = snapshot(&path).unwrap();
    assert_eq!(before.text.as_deref(), Some(original));
    let updated = "\u{feff}const 你好 = 2;\r\n";
    let saved = save(Save {
        upload: None,
        target: target(root.path(), "sample.ts"),
        text: Some(updated.into()),
        revision: before.revision.clone(),
    })
    .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), updated);
    assert_ne!(saved.revision, before.revision);
    fs::write(&path, "external").unwrap();
    assert!(matches!(
        save(Save {
            upload: None,
            target: target(root.path(), "sample.ts"),
            text: Some("stale".into()),
            revision: saved.revision,
        }),
        Err(GuiError::ProjectFileConflict)
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[test]
fn rejects_paths_outside_the_project_and_non_files() {
    let root = project();
    let outside = project();
    fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    assert!(resolve(&target(
        root.path(),
        &execution_path(&outside.path().join("secret.txt"))
    ))
    .is_err());
    assert!(resolve(&target(root.path(), "..")).is_err());
    assert!(resolve(&target(root.path(), ".")).is_err());
    assert!(resolve(&Target {
        chunk: None,
        window: None,
        cwd: ".".into(),
        path: "note.txt".into()
    })
    .is_err());
    fs::write(root.path().join("note.txt"), "valid").unwrap();
    assert!(resolve(&target(root.path(), "note.txt")).is_ok());
}

#[test]
fn binary_and_read_only_files_cannot_be_written() {
    let root = project();
    let binary = root.path().join("binary.bin");
    fs::write(&binary, [0, 1, 2, 255]).unwrap();
    let before = snapshot(&binary).unwrap();
    assert_eq!(before.kind, "binary");
    assert!(save(Save {
        upload: None,
        target: target(root.path(), "binary.bin"),
        text: Some("x".into()),
        revision: before.revision
    })
    .is_err());
    let readonly = root.path().join("readonly.txt");
    fs::write(&readonly, "keep").unwrap();
    let original = fs::metadata(&readonly).unwrap().permissions();
    let mut permissions = original.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&readonly, permissions).unwrap();
    let before = snapshot(&readonly).unwrap();
    assert!(before.read_only);
    assert!(save(Save {
        upload: None,
        target: target(root.path(), "readonly.txt"),
        text: Some("x".into()),
        revision: before.revision
    })
    .is_err());
    fs::set_permissions(&readonly, original).unwrap();
}

#[test]
fn recognizes_images_and_keeps_svg_as_editable_source() {
    let root = project();
    let png = root.path().join("photo.PNG");
    fs::write(&png, [137, 80, 78, 71]).unwrap();
    let document = snapshot(&png).unwrap();
    assert_eq!(document.kind, "image");
    assert!(document
        .image
        .unwrap()
        .starts_with("data:image/png;base64,"));
    let svg = root.path().join("icon.svg");
    fs::write(&svg, "<svg/>").unwrap();
    assert_eq!(snapshot(&svg).unwrap().kind, "text");
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_that_leave_the_project() {
    let root = project();
    let outside = project();
    fs::write(outside.path().join("secret"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret"), root.path().join("link")).unwrap();
    assert!(resolve(&target(root.path(), "link")).is_err());
}

#[test]
fn simultaneous_saves_from_the_same_revision_have_one_winner() {
    let root = project();
    let path = root.path().join("note.txt");
    fs::write(&path, "start").unwrap();
    let revision = snapshot(&path).unwrap().revision;
    let handles: Vec<_> = ["first", "second"]
        .into_iter()
        .map(|text| {
            let request = Save {
                upload: None,
                target: target(root.path(), "note.txt"),
                text: Some(text.into()),
                revision: revision.clone(),
            };
            std::thread::spawn(|| save(request))
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(GuiError::ProjectFileConflict)))
            .count(),
        1
    );
}

#[test]
fn missing_text_is_rejected_but_an_explicit_empty_document_can_be_saved() {
    let root = project();
    let path = root.path().join("note.txt");
    fs::write(&path, "keep").unwrap();
    let revision = snapshot(&path).unwrap().revision;
    let mut body = serde_json::json!({
        "cwd": execution_path(root.path()), "path": "note.txt", "revision": revision,
    });
    assert!(matches!(
        save(serde_json::from_value(body.clone()).unwrap()),
        Err(GuiError::InvalidRequest)
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), "keep");
    body["text"] = serde_json::json!("");
    save(serde_json::from_value(body).unwrap()).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "");
}
