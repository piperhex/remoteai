//! JSON-lines driver for an isolated SSH fixture, never shipped with the application.
use csw_ssh_client::{Client, Command, Connect, Endpoint, FileAction, X11};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Request {
    Probe { endpoint: Endpoint },
    EnsureX11 { options: X11 },
    Open { request: Connect },
    Command { request: Command },
    Files { id: String, request: FileAction },
    Monitor { id: String },
}

async fn request(
    client: Arc<Client>,
    value: Request,
    output: tokio::sync::mpsc::UnboundedSender<Value>,
    stream: Value,
) -> Result<Value, String> {
    let result = match value {
        Request::EnsureX11 { options } => {
            csw_ssh_client::ensure_x11(options)
                .await
                .map_err(|e| e.to_string())?;
            Value::Null
        }
        Request::Probe { endpoint } => json!(csw_ssh_client::probe(endpoint)
            .await
            .map_err(|e| e.to_string())?),
        Request::Open { request } => {
            let info = client
                .open(
                    request,
                    Arc::new(move |event| {
                        output
                            .send(json!({ "stream": stream, "event": event }))
                            .is_ok()
                    }),
                )
                .await
                .map_err(|e| e.to_string())?;
            json!(info)
        }
        Request::Command { request } => {
            client.command(request).await.map_err(|e| e.to_string())?;
            Value::Null
        }
        Request::Monitor { id } => json!(client.monitor(&id).await.map_err(|e| e.to_string())?),
        Request::Files { id, request } => json!(client
            .files(&id, request)
            .await
            .map_err(|e| e.to_string())?),
    };
    Ok(result)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Arc::new(Client::default());
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<Value>();
    tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(message) = receiver.recv().await {
            if stdout
                .write_all(format!("{message}\n").as_bytes())
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let value: Value = serde_json::from_str(&line)?;
        let id = value["id"].clone();
        let input: Request = serde_json::from_value(value["request"].clone())?;
        let client = client.clone();
        let sender = sender.clone();
        tokio::spawn(async move {
            let response = match request(client, input, sender.clone(), id.clone()).await {
                Ok(data) => json!({ "id": id, "data": data }),
                Err(error) => json!({ "id": id, "error": error }),
            };
            if sender.send(response).is_err() {
                eprintln!("SSH test driver output closed");
            }
        });
    }
    Ok(())
}
