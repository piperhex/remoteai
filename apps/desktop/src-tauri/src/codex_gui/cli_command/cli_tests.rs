//! Uses the installed CLI and local HTTP fixtures; no account or model credits are needed.
mod fixture;
mod paged_history;

use serde_json::{json, Value};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines},
    process::{Child, ChildStdin, ChildStdout},
};

const CHILD_MARKER: &str = "CSW_GUI_PROXY_TEST_CHILD";
const TEST_NAME: &str = concat!(
    "codex_gui::cli_command::cli_tests::",
    "real_cli_bypasses_proxy_for_models_and_repeated_turns"
);
const TIMEOUT: Duration = Duration::from_secs(30);

#[test]
#[ignore = "Set CODEX_GUI_TEST_CLI to an installed Codex binary; local fixtures only"]
fn real_cli_bypasses_proxy_for_models_and_repeated_turns() {
    if std::env::var_os(CHILD_MARKER).is_some() {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(check_cli());
        return;
    }
    let proxy = fixture::Server::proxy();
    let output = isolated_child(&proxy.url).output().unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let requests = proxy.requests.lock().unwrap();
    assert!(
        requests
            .iter()
            .any(|path| path.starts_with("http://external.invalid/")),
        "External CLI requests must still use the configured proxy"
    );
    // The CLI also checks external plugin/catalog services; the fixture rejects those CONNECTs.
    assert!(
        requests.iter().all(|path| !path.contains("127.0.0.1")),
        "{requests:?}"
    );
}

fn isolated_child(proxy_url: &str) -> std::process::Command {
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", TEST_NAME, "--ignored", "--nocapture"]);
    command.env(CHILD_MARKER, "1").env_remove("REQUEST_METHOD");
    for name in [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        command.env(name, proxy_url);
    }
    // Override both casings so the developer's own bypass settings cannot mask a regression.
    command
        .env("NO_PROXY", "internal.example")
        .env("no_proxy", "internal.example");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

async fn check_cli() {
    let executable =
        std::env::var_os("CODEX_GUI_TEST_CLI").expect("CODEX_GUI_TEST_CLI is required");
    let executable = Path::new(&executable);
    let local = fixture::Server::local(model_catalog(executable).await);
    let home = tempfile::tempdir().unwrap();
    write_config(home.path(), &local.url);
    let mut client = Client::start(executable, home.path()).await;
    let models = client.rpc("model/list", json!({"limit": 100})).await;
    assert_eq!(models["data"][0]["model"], "gui-proxy-fixture");
    check_turns(&mut client, home.path()).await;
    client.stop().await;
    assert_eq!(local.response_count(), 3);
    // Only the child was changed; the host process retains its original proxy/bypass values.
    assert_eq!(std::env::var("NO_PROXY").unwrap(), "internal.example");
    write_config(home.path(), "http://external.invalid/codex-gui/v1");
    std::fs::remove_file(home.path().join("models_cache.json")).unwrap();
    let mut external = Client::start(executable, home.path()).await;
    external.rpc("model/list", json!({"limit": 100})).await;
    external.stop().await;
}

async fn check_turns(client: &mut Client, home: &Path) {
    let thread = client
        .rpc(
            "thread/start",
            json!({
                "cwd": home, "model": "gui-proxy-fixture",
                "sandbox": "read-only", "approvalPolicy": "never"
            }),
        )
        .await;
    let id = thread["thread"]["id"].as_str().unwrap();
    for index in 0..3 {
        if index == 2 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        let turn = client
            .rpc(
                "turn/start",
                json!({"threadId": id,
            "input": [{"type": "text", "text": format!("test-{index}")}]}),
            )
            .await;
        client.completed(turn["turn"]["id"].as_str().unwrap()).await;
    }
    let saved = client
        .rpc("thread/read", json!({"threadId": id, "includeTurns": true}))
        .await;
    let turns = saved["thread"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), 3);
    assert!(turns.iter().all(|turn| turn["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["text"] == "loopback-ok")));
}

async fn model_catalog(executable: &Path) -> Value {
    let mut command = super::new(executable);
    command.args(["debug", "models", "--bundled"]);
    super::super::platform::hide_window(&mut command);
    let output = command.output().await.unwrap();
    assert!(output.status.success());
    let catalog: Value = serde_json::from_slice(&output.stdout).unwrap();
    let mut model = catalog["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["visibility"] == "list")
        .unwrap()
        .clone();
    model["slug"] = json!("gui-proxy-fixture");
    model["display_name"] = json!("GUI proxy fixture");
    model["supported_in_api"] = json!(true);
    json!({"models": [model]})
}

fn write_config(home: &Path, url: &str) {
    std::fs::write(
        home.join("config.toml"),
        format!(
            "model = 'gui-proxy-fixture'\nmodel_provider = 'codex-switch-gui'\n\
         cli_auth_credentials_store = 'file'\n[features]\napi_key_model_discovery = true\n\
         [model_providers.codex-switch-gui]\nname = 'GUI fixture'\nbase_url = '{url}'\n\
         model_catalog_url = '{url}/models'\nwire_api = 'responses'\n\
         requires_openai_auth = false\nexperimental_bearer_token = 'fixture-token'\n\
         supports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n"
        ),
    )
    .unwrap();
}

struct Client {
    child: Child,
    writer: ChildStdin,
    reader: Lines<BufReader<ChildStdout>>,
    sequence: u64,
}

impl Client {
    async fn start(executable: &Path, home: &Path) -> Self {
        let mut command = super::new(executable);
        command
            .arg("app-server")
            .env("CODEX_HOME", home)
            .current_dir(home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        super::super::platform::hide_window(&mut command);
        let mut child = command.spawn().unwrap();
        let mut client = Self {
            writer: child.stdin.take().unwrap(),
            reader: BufReader::new(child.stdout.take().unwrap()).lines(),
            child,
            sequence: 0,
        };
        client
            .rpc(
                "initialize",
                json!({"clientInfo": {"name": "codex-tui", "version": "0.162.1"},
            "capabilities": {"experimentalApi": true}}),
            )
            .await;
        client.write(json!({"method": "initialized"})).await;
        client
    }

    async fn write(&mut self, message: Value) {
        self.writer
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn read(&mut self) -> Value {
        let line = self
            .reader
            .next_line()
            .await
            .unwrap()
            .expect("CLI disconnected");
        serde_json::from_str(&line).unwrap()
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.sequence += 1;
        self.write(json!({"id": self.sequence, "method": method, "params": params}))
            .await;
        tokio::time::timeout(TIMEOUT, async {
            loop {
                let message = self.read().await;
                if message["id"] == self.sequence {
                    assert!(message.get("error").is_none(), "{message}");
                    return message["result"].clone();
                }
            }
        })
        .await
        .expect("CLI RPC timed out")
    }

    async fn completed(&mut self, turn: &str) {
        tokio::time::timeout(TIMEOUT, async {
            loop {
                let message = self.read().await;
                if message["method"] == "turn/completed" && message["params"]["turn"]["id"] == turn
                {
                    assert_eq!(
                        message["params"]["turn"]["status"], "completed",
                        "{message}"
                    );
                    return;
                }
            }
        })
        .await
        .expect("CLI turn timed out");
    }

    async fn stop(&mut self) {
        self.child.kill().await.unwrap();
        self.child.wait().await.unwrap();
    }
}
