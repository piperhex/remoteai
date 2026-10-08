use super::*;

fn replacement() -> (tempfile::TempDir, Replacement) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("installed");
    let staged = directory.path().join("new");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(&staged).unwrap();
    std::fs::write(root.join("runtime"), "old").unwrap();
    std::fs::write(staged.join("runtime"), "new").unwrap();
    let replacement = Replacement {
        directory: None,
        root,
        staged,
        backup: directory.path().join("previous"),
    };
    (directory, replacement)
}

#[test]
fn failed_activation_restores_the_complete_previous_runtime() {
    let (_directory, mut replacement) = replacement();
    replacement.replace().unwrap();
    assert_eq!(
        std::fs::read(replacement.root.join("runtime")).unwrap(),
        b"new"
    );
    assert_eq!(
        std::fs::read(replacement.backup.join("runtime")).unwrap(),
        b"old"
    );
    replacement.restore().unwrap();
    assert_eq!(
        std::fs::read(replacement.root.join("runtime")).unwrap(),
        b"old"
    );
    assert_eq!(
        std::fs::read(replacement.staged.join("runtime")).unwrap(),
        b"new"
    );
}

#[test]
fn failed_second_move_can_restore_the_previous_directory() {
    let (_directory, mut replacement) = replacement();
    std::fs::remove_dir_all(&replacement.staged).unwrap();
    assert!(replacement.replace().is_err());
    replacement.restore().unwrap();
    assert_eq!(
        std::fs::read(replacement.root.join("runtime")).unwrap(),
        b"old"
    );
}

#[test]
fn elevated_helper_rechecks_version_and_rejects_downgrades() {
    let target = Version::parse("1.7.11").unwrap();
    assert!(can_replace("1.7.3", &target).unwrap());
    assert!(can_replace("1.7.11", &target).unwrap());
    assert!(!can_replace("1.7.12", &target).unwrap());
    assert!(can_replace("unknown", &target).is_err());
}

#[test]
fn updating_preserves_identity_credentials_and_read_only_permissions() {
    let original = configuration::Configuration {
        base_url: "https://example.test".into(),
        credential: "fixture-device-credential".into(),
        device_id: "fixture-device".into(),
        name: "Fixture".into(),
        version: "1.7.3".into(),
        identity_secret: "fixture-identity".into(),
        owner_sid: "fixture-owner".into(),
        permissions: crate::remote_desktop::permissions::Permissions {
            control: false,
            clipboard_write: false,
            files: false,
            ..Default::default()
        },
    };
    let updated = updated_configuration(&original, &Version::parse("1.7.11").unwrap());
    assert_eq!(updated.version, "1.7.11");
    assert_eq!(original.version, "1.7.3");
    let mut expected = serde_json::to_value(&original).unwrap();
    expected["version"] = "1.7.11".into();
    assert_eq!(serde_json::to_value(updated).unwrap(), expected);
}
