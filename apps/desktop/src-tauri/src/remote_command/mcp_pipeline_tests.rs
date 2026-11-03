//! The fixture replaces the cloud coordinator; STDIO dispatch, HTTP bridge and shell execution are real.
use super::super::{executor, protocol::ToolRequest};
use super::*;
use std::{fs, io::Cursor, thread, time::Duration};

#[test]
fn tool_entry_runs_eight_controlled_shells_concurrently() {
    let root = std::env::temp_dir().join(format!("csw-mcp-pipeline-{}", uuid::Uuid::new_v4()));
    let record = state::Record {
        home: root.join("home"),
        token: "pipeline-token".into(),
        enabled: true,
    };
    state::save(&root, &record).unwrap();
    let id = state::home_id(&record.home);
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    state::write(
        &root.join("endpoint.json"),
        &json!({"port":server.server_addr().to_ip().unwrap().port()}),
    )
    .unwrap();
    let fixture = thread::spawn(move || {
        let mut workers = Vec::new();
        for _ in 0..8 {
            let mut request = server
                .recv_timeout(Duration::from_secs(40))
                .unwrap()
                .unwrap();
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            let ToolRequest::Execute { request: command } = serde_json::from_str(&body).unwrap()
            else {
                panic!("expected a command")
            };
            workers.push(thread::spawn(move || {
                let output =
                    tauri::async_runtime::block_on(executor::execute(command.command, || true))
                        .unwrap();
                assert!(!output.timed_out, "STDIO serialized the commands");
                request
                    .respond(tiny_http::Response::from_string(
                        json!({"result":{"data":output,"error":""}}).to_string(),
                    ))
                    .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
    });
    let input = (0..8).map(|index| {
        let marker = root.join(format!("{index}.ready"));
        let command = if cfg!(windows) {
            format!("Set-Content -LiteralPath '{}' -Value ready; while ((Get-ChildItem -LiteralPath '{}' -Filter '*.ready').Count -lt 8) {{ Start-Sleep -Milliseconds 100 }}; Write-Output '{index}'",
                marker.display(), root.display())
        } else {
            format!("touch '{}'; while [ $(find '{}' -name '*.ready' | wc -l) -lt 8 ]; do sleep 0.1; done; echo '{index}'",
                marker.display(), root.display())
        };
        json!({"jsonrpc":"2.0","id":index,"method":"tools/call","params":{
            "name":"remote_execute","arguments":{"deviceId":"df73d734-9cda-43ba-9e27-9d496af3fd05",
                "command":command,"timeoutSeconds":40}
        }}).to_string()+"\n"
    }).collect::<String>();
    let mut output = Vec::new();
    super::super::mcp_stream::run(Cursor::new(input), &mut output, |request| {
        dispatch(&root, &id, &record.token, request)
    })
    .unwrap();
    fixture.join().unwrap();
    let mut ids = std::collections::HashSet::new();
    for line in String::from_utf8(output).unwrap().lines() {
        let response: Value = serde_json::from_str(line).unwrap();
        assert_eq!(response["result"]["isError"], false);
        let result: Value =
            serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(
            result["data"]["stdout"].as_str().unwrap().trim(),
            response["id"].to_string()
        );
        assert!(ids.insert(response["id"].as_u64().unwrap()));
    }
    assert_eq!(ids.len(), 8);
    fs::remove_dir_all(root).unwrap();
}
