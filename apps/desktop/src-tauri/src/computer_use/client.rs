//! An isolated, revocable connection to the GUI's managed computer-use installation.
use super::{install, package, platform, state, ComputerError, Result, CHANGES};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

const START_TIMEOUT: Duration = Duration::from_secs(10);
const TOOL_TIMEOUT: Duration = Duration::from_secs(super::TOOL_TIMEOUT_SECONDS);
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_TOOL_PAGES: usize = 8;
const TOOLS: &[&str] = &[
    "list_apps",
    "list_windows",
    "get_window_state",
    "get_desktop_state",
    "get_accessibility_tree",
    "get_screen_size",
    "get_cursor_position",
    "check_permissions",
    "start_session",
    "end_session",
    "get_session",
    "get_session_state",
    "click",
    "double_click",
    "right_click",
    "drag",
    "scroll",
    "move_cursor",
    "press_key",
    "hotkey",
    "type_text",
    "set_value",
    "invoke_menu",
    "bring_to_front",
    "verify_state",
    "zoom",
    "get_guide",
    "run_steps",
    "run_script",
];

struct Installation {
    root: PathBuf,
    id: String,
    generation: String,
}

/// Owns a separate native runtime; dropping it also stops in-flight desktop actions.
pub(crate) struct ComputerSession {
    process: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    installation: Installation,
    tools: Vec<Value>,
    next_id: u64,
}

fn prepare(home: PathBuf) -> Result<(std::process::Command, Installation)> {
    let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
    platform::asset()?;
    let root = super::root()?;
    let id = state::home_id(&home);
    let record = state::read(&root, &id)?
        .filter(|record| record.enabled)
        .ok_or(ComputerError::Disabled)?;
    if !install::configured(&home, true)? || !package::present(&root)? {
        return Err(ComputerError::Disabled);
    }
    let mut command =
        std::process::Command::new(std::env::current_exe().map_err(|_| ComputerError::Startup)?);
    command.arg(format!("{}{id}", super::HELPER_ARGUMENT));
    platform::configure_driver(&mut command);
    Ok((
        command,
        Installation {
            root,
            id,
            generation: record.generation,
        },
    ))
}

impl ComputerSession {
    pub(crate) async fn connect(home: PathBuf) -> Result<Self> {
        let (command, installation) = tauri::async_runtime::spawn_blocking(move || prepare(home))
            .await
            .map_err(|_| ComputerError::Startup)??;
        Self::start(command, installation).await
    }

    async fn start(command: std::process::Command, installation: Installation) -> Result<Self> {
        let mut process = Command::from(command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| ComputerError::Startup)?;
        let input = process.stdin.take().ok_or(ComputerError::Startup)?;
        let output = BufReader::new(process.stdout.take().ok_or(ComputerError::Startup)?);
        let mut client = Self {
            process,
            input,
            output,
            installation,
            tools: Vec::new(),
            next_id: 0,
        };
        tokio::time::timeout(START_TIMEOUT, client.initialize())
            .await
            .map_err(|_| ComputerError::Startup)??;
        Ok(client)
    }

    pub(crate) fn tools(&self) -> &[Value] {
        &self.tools
    }

    async fn initialize(&mut self) -> Result<()> {
        self.request(
            "initialize",
            json!({"protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "remote-ai-help", "version": env!("CARGO_PKG_VERSION")}}),
        )
        .await?;
        self.write(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            .await?;
        let mut params = json!({});
        for _ in 0..MAX_TOOL_PAGES {
            let result = self.request("tools/list", params).await?;
            let entries = result["tools"].as_array().ok_or(ComputerError::Startup)?;
            self.tools.extend(entries.iter().filter_map(function_tool));
            match result["nextCursor"]
                .as_str()
                .filter(|cursor| !cursor.is_empty())
            {
                Some(cursor) => params = json!({"cursor": cursor}),
                None => return Ok(()),
            }
        }
        Err(ComputerError::Startup)
    }

    pub(crate) async fn call(&mut self, name: &str, arguments: Value) -> Result<Value> {
        if !arguments.is_object() || !self.tools.iter().any(|tool| tool["name"] == name) {
            return Err(ComputerError::Disabled);
        }
        let result = tokio::time::timeout(
            TOOL_TIMEOUT,
            self.request("tools/call", json!({"name": name, "arguments": arguments})),
        )
        .await;
        match result {
            Ok(Ok(value)) => Ok(value),
            failure => {
                if self.process.start_kill().is_err() {
                    eprintln!("Computer-use request ended after its process stopped");
                }
                Err(failure
                    .err()
                    .map(|_| ComputerError::Startup)
                    .unwrap_or(ComputerError::Disabled))
            }
        }
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        check_allowed(&self.installation).await?;
        self.next_id += 1;
        let id = self.next_id;
        self.write(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await?;
        tokio::select! {
            result = receive(&mut self.output, &mut self.input, id) => result,
            error = revoked(&self.installation) => Err(error),
        }
    }

    async fn write(&mut self, value: Value) -> Result<()> {
        write(&mut self.input, value).await
    }
}

fn function_tool(tool: &Value) -> Option<Value> {
    let name = tool["name"].as_str()?;
    if !TOOLS.contains(&name) || !tool["inputSchema"].is_object() {
        return None;
    }
    Some(
        json!({"type": "function", "name": name, "description": tool["description"],
        "parameters": tool["inputSchema"], "strict": false}),
    )
}

async fn write(input: &mut ChildStdin, value: Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(&value).map_err(|_| ComputerError::Startup)?;
    bytes.push(b'\n');
    input
        .write_all(&bytes)
        .await
        .map_err(|_| ComputerError::Startup)
}

async fn receive(
    output: &mut BufReader<ChildStdout>,
    input: &mut ChildStdin,
    id: u64,
) -> Result<Value> {
    loop {
        let mut bytes = Vec::new();
        let size = output
            .take((MAX_MESSAGE_BYTES + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|_| ComputerError::Startup)?;
        if size == 0 || size > MAX_MESSAGE_BYTES {
            return Err(ComputerError::Startup);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| ComputerError::Startup)?;
        if value.get("method").is_some() {
            if value.get("id").is_some() {
                write(
                    input,
                    json!({"jsonrpc": "2.0", "id": value["id"], "error": {
                    "code": -32601, "message": "Client requests are not supported"}}),
                )
                .await?;
            }
            continue;
        }
        if value["id"] != id {
            continue;
        }
        if value.get("error").is_some() {
            return Err(ComputerError::Startup);
        }
        return value.get("result").cloned().ok_or(ComputerError::Startup);
    }
}

async fn check_allowed(installation: &Installation) -> Result<()> {
    let Installation {
        root,
        id,
        generation,
    } = installation;
    let (root, id, generation) = (root.clone(), id.clone(), generation.clone());
    let allowed =
        tauri::async_runtime::spawn_blocking(move || state::allowed(&root, &id, &generation))
            .await
            .map_err(|_| ComputerError::Storage)?;
    if allowed {
        Ok(())
    } else {
        Err(ComputerError::Disabled)
    }
}

async fn revoked(installation: &Installation) -> ComputerError {
    loop {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Err(error) = check_allowed(installation).await {
            return error;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires an enabled local Computer Use installation and CSW_HELP_COMPUTER_TEST_HOME"]
    async fn managed_installation_connects_and_lists_applications() {
        let home = std::env::var_os("CSW_HELP_COMPUTER_TEST_HOME").unwrap();
        let root = super::super::root().unwrap();
        let id = state::home_id(&PathBuf::from(home));
        let record = state::read(&root, &id)
            .unwrap()
            .filter(|record| record.enabled)
            .unwrap();
        // The test executable differs from the registered GUI command; leave that registration untouched.
        // Production connect() additionally validates the GUI's exact managed configuration in prepare().
        let command = super::super::session::driver_command(&root).unwrap();
        let installation = Installation {
            root,
            id,
            generation: record.generation,
        };
        let mut session = ComputerSession::start(command, installation).await.unwrap();
        assert!(session
            .tools()
            .iter()
            .any(|tool| tool["name"] == "get_window_state"));
        let result = session.call("list_apps", json!({})).await.unwrap();
        assert_ne!(result["isError"], true);
        assert!(result["content"]
            .as_array()
            .is_some_and(|content| !content.is_empty()));
    }
    #[test]
    fn exposes_only_supported_desktop_tools_with_their_actual_schema() {
        let schema = json!({"type": "object", "properties": {"text": {"type": "string"}}});
        let tool = function_tool(&json!({"name": "type_text", "inputSchema": schema})).unwrap();
        assert_eq!(tool["parameters"], schema);
        assert_eq!(tool["strict"], false);
        for name in ["get_guide", "run_steps", "run_script"] {
            let tool = function_tool(&json!({"name": name, "inputSchema": schema})).unwrap();
            assert_eq!(tool["parameters"], schema);
        }
        for name in [
            "shell",
            "page",
            "set_config",
            "escalate_session",
            "clipboard_read",
            "browser_type",
            "install_extension",
        ] {
            assert!(function_tool(&json!({"name": name, "inputSchema": schema})).is_none());
        }
    }
}
