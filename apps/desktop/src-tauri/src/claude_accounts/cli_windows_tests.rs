use super::super::{login, store};
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

const TEST_NAME: &str =
    "claude_accounts::cli::windows_tests::managed_login_and_identity_work_without_node_on_path";
const FIXTURE: &str = include_str!("../../../scripts/fixtures/claude-login.cjs");

fn fixture_node() -> PathBuf {
    let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/desktop-service/node.exe");
    if bundled.is_file() {
        return bundled;
    }
    // CI runs tests before packaging. Copy its toolchain Node into the fixture bundle first;
    // the login under test still has an empty PATH and cannot use that toolchain installation.
    std::env::split_paths(&std::env::var_os("PATH").expect("test toolchain PATH"))
        .map(|directory| directory.join("node.exe"))
        .find(|path| path.is_file())
        .expect("Node fixture from the bundle or test toolchain")
}

#[test]
fn managed_login_and_identity_work_without_node_on_path() {
    if let Some(root) = std::env::var_os("REMOTEAI_TEST_ROOT") {
        exercise_login(Path::new(&root));
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("Remote AI & spaces");
    let bundled_node = root.join("resources/desktop-service/node.exe");
    std::fs::create_dir_all(bundled_node.parent().unwrap()).unwrap();
    std::fs::copy(fixture_node(), &bundled_node).expect("bundled Node fixture");
    // Isolate PATH changes from other Rust tests and never touch the user's environment.
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", TEST_NAME, "--nocapture"])
        .current_dir(&root)
        .env("REMOTEAI_TEST_ROOT", &root)
        .env("REMOTEAI_TEST_NODE", &bundled_node)
        .env("PATH", "")
        .env("ANTHROPIC_API_KEY", "must-be-removed")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn exercise_login(root: &Path) {
    assert!(Command::new("node").arg("--version").output().is_err());
    let data = root.join("account data & spaces");
    let package = data.join("cli-gui/runtime/node_modules/@anthropic-ai/claude-code");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("cli.js"), FIXTURE).unwrap();
    let node = PathBuf::from(std::env::var_os("REMOTEAI_TEST_NODE").unwrap());
    let status = login::start(&data, None, node).expect("managed login starts without global Node");
    let waiting = wait_for(&status.login_id, "waiting");
    assert!(waiting.authorization_url.is_some());
    login::submit(&status.login_id, "fixture-code").unwrap();
    let complete = wait_for(&status.login_id, "complete");
    let account = store::read(&data, complete.account_id.as_deref().unwrap()).unwrap();
    assert_eq!(account.email, "fixture@example.com");
    assert_eq!(
        std::fs::read_to_string(root.join("commands.jsonl")).unwrap(),
        "[\"auth\",\"login\",\"--claudeai\"]\n[\"auth\",\"status\",\"--json\"]\n"
    );
}

fn wait_for(id: &str, expected: &str) -> login::LoginStatus {
    let started = Instant::now();
    loop {
        let status = login::poll(id).unwrap();
        if status.status == expected {
            return status;
        }
        assert_ne!(status.status, "failed", "login failed: {:?}", status.error);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "waiting for {expected}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn native_cli_still_takes_precedence_over_node() {
    let temporary = tempfile::tempdir().unwrap();
    let package = temporary
        .path()
        .join("cli-gui/runtime/node_modules/@anthropic-ai/claude-code");
    std::fs::create_dir_all(package.join("bin")).unwrap();
    let native = package.join("bin/claude.exe");
    std::fs::write(&native, []).unwrap();
    std::fs::write(package.join("cli.js"), []).unwrap();
    let command = super::command(temporary.path(), None, Path::new("unused-node.exe")).unwrap();
    assert_eq!(command.get_program(), native.as_os_str());
    assert_eq!(command.get_args().count(), 0);
}
