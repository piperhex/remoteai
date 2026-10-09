//! Two-PC regression probe. Use a fresh session/secret, never a production chat grant.
use std::{error::Error, time::Duration};

use csw_chat_connectivity::{Config, Connection, Event};

const ROUNDS: usize = 10;
const PAYLOAD_BYTES: usize = 32 * 1024;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("expected fixture config path")?;
    let config: Config = serde_json::from_slice(&std::fs::read(path)?)?;
    let desktop = config.desktop;
    let connection = Connection::start(config)?;
    let result = tokio::time::timeout(Duration::from_secs(120), probe(&connection, desktop)).await;
    connection.close();
    result??;
    Ok(())
}

async fn probe(connection: &Connection, desktop: bool) -> Result<(), Box<dyn Error>> {
    let mut round = 0;
    let mut direct = false;
    while let Some(event) = connection.receive().await {
        match event {
            Event::Open if !desktop => connection.send(payload(round)).await?,
            Event::Data { text } if desktop => connection.send(text).await?,
            Event::Data { text } => {
                if text != payload(round) {
                    return Err("echo mismatch".into());
                }
                round += 1;
                println!("verified round={round} bytes={}", text.len());
                if round == ROUNDS {
                    if !direct {
                        return Err("no direct route reported".into());
                    }
                    println!("PASS rounds={round} bytes={}", round * PAYLOAD_BYTES);
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
                connection.send(payload(round)).await?;
            }
            Event::Closed => return Err("connection closed".into()),
            event => {
                if let Event::Status { route } = &event {
                    direct = route.direct;
                }
                println!("{}", serde_json::to_string(&event)?);
            }
        }
    }
    Err("event stream closed".into())
}

fn payload(round: usize) -> String {
    let prefix = format!("native-probe-{round}:");
    format!("{prefix}{}", "x".repeat(PAYLOAD_BYTES - prefix.len()))
}
