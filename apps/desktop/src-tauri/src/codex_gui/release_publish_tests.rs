use super::super::store::{self, tests::Fixture};
use super::*;
use std::path::PathBuf;

const VERSION: &str = "0.162.0";

fn source_package(root: &Path) -> PathBuf {
    let source = root.join("staging");
    fs::create_dir_all(source.join("bin")).unwrap();
    fs::create_dir_all(source.join("codex-resources/nested")).unwrap();
    fs::create_dir_all(source.join("codex-path/empty")).unwrap();
    fs::write(source.join(entrypoint()), b"verified executable").unwrap();
    fs::write(source.join("codex-resources/nested/helper"), b"helper").unwrap();
    source
}

#[test]
fn copies_the_complete_package_and_preserves_the_source() {
    let fixture = Fixture::new();
    let source = source_package(&fixture.0);
    store::stage(&fixture.0, VERSION, &source).unwrap();
    let destination = fixture.0.join(VERSION);
    for relative in [entrypoint(), "codex-resources/nested/helper"] {
        assert_eq!(
            fs::read(source.join(relative)).unwrap(),
            fs::read(destination.join(relative)).unwrap()
        );
    }
    assert!(destination.join("codex-path/empty").is_dir());
    assert!(!destination.join(INCOMPLETE_MARKER).exists());
    assert!(store::ready(&fixture.0, VERSION));
    fixture.remember(VERSION);
    assert_eq!(
        store::activate(&fixture.0).unwrap().version.as_deref(),
        Some(VERSION)
    );
}

#[test]
fn an_interrupted_copy_never_activates_and_resumes_on_retry() {
    let fixture = Fixture::new();
    fixture.package("0.161.0");
    fixture.remember("0.161.0");
    store::activate(&fixture.0).unwrap();
    fixture.remember(VERSION);
    let source = source_package(&fixture.0);
    let destination = fixture.0.join(VERSION);
    fs::create_dir_all(destination.join("bin")).unwrap();
    fs::write(destination.join(INCOMPLETE_MARKER), b"").unwrap();
    fs::write(destination.join(entrypoint()), b"partial executable").unwrap();
    fs::write(destination.join("codex-resources"), b"directory conflict").unwrap();
    assert!(store::stage(&fixture.0, VERSION, &source).is_err());
    assert!(!store::ready(&fixture.0, VERSION));
    assert!(!store::pending(&fixture.0).unwrap().unwrap().ready);
    assert_eq!(
        store::activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.161.0")
    );
    assert!(source.join(entrypoint()).is_file());
    fs::remove_file(destination.join("codex-resources")).unwrap();
    store::stage(&fixture.0, VERSION, &source).unwrap();
    assert_eq!(
        store::activate(&fixture.0).unwrap().version.as_deref(),
        Some(VERSION)
    );
    assert_eq!(
        fs::read(destination.join(entrypoint())).unwrap(),
        b"verified executable"
    );
    assert!(destination.join("codex-resources/nested/helper").is_file());
}

#[test]
fn completed_packages_are_reused_without_overwriting_running_files() {
    let fixture = Fixture::new();
    fixture.package(VERSION);
    let source = source_package(&fixture.0);
    store::stage(&fixture.0, VERSION, &source).unwrap();
    assert_eq!(
        fs::read(fixture.0.join(VERSION).join(entrypoint())).unwrap(),
        b"verified test package"
    );
    assert!(source.join(entrypoint()).is_file());
}

#[test]
fn package_contents_cannot_override_the_completion_marker() {
    let fixture = Fixture::new();
    let source = source_package(&fixture.0);
    fs::write(source.join(INCOMPLETE_MARKER), b"untrusted marker").unwrap();
    assert!(matches!(
        store::stage(&fixture.0, VERSION, &source),
        Err(GuiError::Integrity)
    ));
    assert!(!store::ready(&fixture.0, VERSION));
}

#[cfg(windows)]
#[test]
fn copying_succeeds_while_a_source_file_is_open_without_delete_sharing() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

    let fixture = Fixture::new();
    let source = source_package(&fixture.0);
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(source.join(entrypoint()))
        .unwrap();
    // This is the Windows handle state that made directory renaming fail with error 5.
    store::stage(&fixture.0, VERSION, &source).unwrap();
    assert!(store::ready(&fixture.0, VERSION));
    assert!(source.join(entrypoint()).is_file());
    assert_eq!(
        held.metadata().unwrap().len(),
        b"verified executable".len() as u64
    );
    drop(held);
}

#[cfg(unix)]
#[test]
fn copying_preserves_executable_permissions_and_rejects_destination_links() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let fixture = Fixture::new();
    let source = source_package(&fixture.0);
    fs::set_permissions(source.join(entrypoint()), fs::Permissions::from_mode(0o755)).unwrap();
    store::stage(&fixture.0, VERSION, &source).unwrap();
    let mode = fs::metadata(fixture.0.join(VERSION).join(entrypoint()))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o755);
    let destination = fixture.0.join("0.163.0");
    fs::create_dir(&destination).unwrap();
    let outside = fixture.0.join("outside");
    fs::write(&outside, b"unchanged").unwrap();
    symlink(&outside, destination.join("bin")).unwrap();
    assert!(store::stage(&fixture.0, "0.163.0", &source).is_err());
    assert_eq!(fs::read(outside).unwrap(), b"unchanged");
    assert!(!store::ready(&fixture.0, "0.163.0"));
}
