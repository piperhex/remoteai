use super::*;

#[test]
fn broken_archives_and_missing_executables_have_specific_errors() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("package.tar.gz");
    let destination = root.path().join("unpacked");
    fs::create_dir(&destination).unwrap();
    fs::write(&path, b"not a gzip archive").unwrap();
    assert!(matches!(
        unpack(&path, &destination),
        Err(GuiError::InstallUnpack)
    ));
    let file = fs::File::create(&path).unwrap();
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    tar::Builder::new(encoder)
        .into_inner()
        .unwrap()
        .finish()
        .unwrap();
    assert!(matches!(
        unpack(&path, &destination),
        Err(GuiError::InstallMissingExecutable)
    ));
}

#[test]
fn version_and_archive_paths_cannot_escape_the_managed_directory() {
    for version in ["../official", "1/2", "", "C:/codex", "1.2.3/../outside"] {
        assert!(!valid_version(version));
    }
    assert!(valid_version("0.153.4"));
    assert!(valid_version("0.154.0-alpha.6"));
}

#[test]
fn unpack_rejects_symlink_entries() {
    let root =
        std::env::temp_dir().join(format!("codex-gui-archive-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let path = root.join("bad.tar.gz");
    let file = fs::File::create(&path).unwrap();
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let mut archive = tar::Builder::new(encoder);
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o755);
    archive
        .append_link(&mut header, "escape", "../outside")
        .unwrap();
    archive.into_inner().unwrap().finish().unwrap();
    assert!(unpack(&path, &root.join("unpacked")).is_err());
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
}

/// Opt-in network smoke test for the exact installer used by the desktop UI.
#[test]
#[ignore = "downloads the official release package from GitHub"]
fn official_release_download_and_extract() {
    let client = http_client().unwrap();
    let (version, asset) = release(&client, None).unwrap();
    let root = std::env::temp_dir().join("codex-switch-gui-release-smoke");
    fs::create_dir_all(&root).unwrap();
    let archive = root.join(format!("{version}.tar.gz"));
    download(|_| {}, &client, &asset, &archive).unwrap();
    let package = root.join(&version);
    fs::create_dir_all(&package).unwrap();
    unpack(&archive, &package).unwrap();
    println!(
        "Verified official CLI: {}",
        package.join(entrypoint()).display()
    );
}
#[test]
fn gui_cli_processes_are_excluded_from_external_client_restarts() {
    use std::path::Path;
    for path in [
        "/app/codex-cli/0.116.0/bin/codex",
        "/app/codex-cli/0.117.0-alpha.1/bin/codex",
        "/app/codex-cli/0.116.0/bin/codex.exe",
    ] {
        assert!(super::is_gui_executable(Path::new(path)));
    }
    for path in [
        "/usr/local/bin/codex",
        "/Applications/Codex.app/Contents/MacOS/Codex",
        "/app/codex-cli/not-a-version/bin/codex",
        "/app/other-cli/0.116.0/bin/codex",
    ] {
        assert!(!super::is_gui_executable(Path::new(path)));
    }
}
