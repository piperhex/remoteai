use super::*;
use std::{fs, path::Path};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("gui-file-actions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn target(path: &str) -> FileTarget {
    FileTarget {
        path: path.into(),
        thread_id: None,
        line: Some(12),
        column: Some(3),
    }
}

#[test]
fn rejects_network_device_url_and_control_paths() {
    for path in [
        "",
        "//server/share.txt",
        r"\\server\share.txt",
        "https://host/a.txt",
        "a\0.txt",
        "a\n.txt",
    ] {
        assert!(paths::source(&target(path)).is_err(), "{path:?}");
    }
    #[cfg(windows)]
    for path in [
        r"\\?\C:\secret.txt",
        "C:/file.txt:stream",
        "C:relative.txt",
        "NUL.txt",
        "src/COM1",
        "/root/a",
    ] {
        assert!(paths::source(&target(path)).is_err(), "{path}");
    }
    let mut invalid_line = target("readme.md");
    invalid_line.line = Some(0);
    assert!(paths::source(&invalid_line).is_err());
}

#[test]
fn resolves_relative_files_using_the_task_workspace_and_keeps_missing_paths_copyable() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("报告 space.txt"), "contents").unwrap();
    let path = paths::resolve(Path::new("报告 space.txt"), &fixture.0, false).unwrap();
    assert_eq!(read_text(&path).unwrap(), "contents");
    assert!(paths::resolve(Path::new("deleted.txt"), &fixture.0, false).is_err());
    assert!(paths::resolve(Path::new("deleted.txt"), &fixture.0, true).is_ok());
    assert!(paths::resolve(Path::new("relative.txt"), Path::new(""), true).is_err());
}

#[test]
fn copies_empty_and_utf8_text_but_rejects_binary_directories_and_large_files() {
    let fixture = Fixture::new();
    let path = fixture.0.join("file.txt");
    for content in ["", "中文\ntext"] {
        fs::write(&path, content).unwrap();
        assert_eq!(read_text(&path).unwrap(), content);
    }
    for bytes in [
        vec![0xff, 0xfe],
        b"binary\0data".to_vec(),
        vec![b'a'; 2 * 1024 * 1024 + 1],
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(read_text(&path).is_err());
    }
    assert!(read_text(&fixture.0).is_err());
}

#[test]
fn only_known_applications_and_actions_cross_ipc() {
    let copy: FileRequest = serde_json::from_value(serde_json::json!({
        "target": {"path": "installer.msi"}, "action": {"type": "copyFile"}
    }))
    .unwrap();
    assert!(matches!(copy.action, FileAction::CopyFile {}));
    assert!(serde_json::from_value::<FileRequest>(serde_json::json!({
        "target": {"path": "installer.msi"}, "action": {"type": "copyFile", "destination": "anything"}
    }))
    .is_err());
    assert!(serde_json::from_value::<FileRequest>(serde_json::json!({
        "target": {"path": "file.txt"}, "action": {"type": "open", "application": "powershell -Command bad"}
    })).is_err());
    assert!(serde_json::from_value::<FileRequest>(serde_json::json!({
        "target": {"path": "file.txt"}, "action": {"type": "saveAs", "destination": "anything"}
    }))
    .is_err());
}

#[test]
#[ignore = "writes to the system clipboard; run explicitly in a desktop session"]
fn copies_binary_file_references_to_the_native_clipboard() {
    let fixture = Fixture::new();
    let source = fixture.0.join("安装包 space & test.msi");
    let file = File::create(&source).unwrap();
    file.set_len(3 * 1024 * 1024).unwrap();
    drop(file);
    let path = paths::resolve(&source, Path::new(""), false).unwrap();
    assert!(read_text(&path).is_err());
    copy_file(&path).unwrap();
    // Read after the writer is dropped, as Explorer/Finder does when the user pastes.
    let mut clipboard = arboard::Clipboard::new().unwrap();
    let files = clipboard.get().file_list().unwrap();
    assert_eq!(files, vec![source.clone()]);
    assert_eq!(fs::metadata(&files[0]).unwrap().len(), 3 * 1024 * 1024);
    #[cfg(windows)]
    assert_shell_pastes_file(&source, &fixture.0.join("pasted"));
    assert!(source.exists());
    clipboard.clear().unwrap();
}

#[cfg(windows)]
fn assert_shell_pastes_file(source: &Path, destination: &Path) {
    use std::os::windows::process::CommandExt;
    fs::create_dir(destination).unwrap();
    // Exercise Explorer's paste verb in another process, without opening a window.
    let script = r#"
        $ErrorActionPreference = 'Stop'
        $shell = New-Object -ComObject Shell.Application
        $shell.Namespace($env:CSW_COPY_TEST_DESTINATION).Self.InvokeVerb('paste')
        $name = [IO.Path]::GetFileName($env:CSW_COPY_TEST_SOURCE)
        $pasted = Join-Path $env:CSW_COPY_TEST_DESTINATION $name
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ([DateTime]::UtcNow -lt $deadline) {
            if (Test-Path -LiteralPath $pasted) { exit 0 }
            Start-Sleep -Milliseconds 50
        }
        throw 'Explorer did not paste the copied file.'
    "#;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
        .env("CSW_COPY_TEST_SOURCE", source)
        .env("CSW_COPY_TEST_DESTINATION", destination)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let pasted = destination.join(source.file_name().unwrap());
    assert_eq!(fs::read(pasted).unwrap(), fs::read(source).unwrap());
}

#[test]
fn editor_arguments_preserve_spaces_metacharacters_and_line_numbers() {
    use apps::ApplicationId;
    let mut command = std::process::Command::new("editor");
    let path = Path::new("report space & $(value).txt");
    apps::editor_arguments(
        &mut command,
        ApplicationId::Vscode,
        path,
        &target("ignored"),
    );
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["--goto", "report space & $(value).txt:12:3"]
    );
    let mut command = std::process::Command::new("editor");
    apps::editor_arguments(&mut command, ApplicationId::Idea, path, &target("ignored"));
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["--line", "12", "report space & $(value).txt"]
    );
}

#[cfg(windows)]
#[test]
fn terminal_uses_working_directory_without_executing_the_file() {
    let fixture = Fixture::new();
    let path = fixture.0.join("report & echo dangerous.txt");
    fs::write(&path, "safe").unwrap();
    let command = windows::command(
        apps::ApplicationId::Terminal,
        Path::new("powershell.exe"),
        &path,
        &target("ignored"),
    )
    .unwrap();
    assert_eq!(command.get_current_dir(), Some(fixture.0.as_path()));
    assert_eq!(command.get_args().collect::<Vec<_>>(), ["-NoLogo"]);
}
