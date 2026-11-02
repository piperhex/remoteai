//! Read only the Codex API and CLI components from OpenAI's public status feed.
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

const STATUS_ENDPOINT: &str = "https://status.openai.com/api/v2/components.json";
const API_ID: &str = "01KMP3KP5MGE23B80K1EK4S8PV";
const CLI_ID: &str = "01KMKFAMWKNQ84Z1766MV08ZDE";
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const SAFE_ERROR: &str = "client.codexStatus.unknownHint";

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ServiceHealth {
    Operational,
    Disrupted,
    Unknown,
}

#[derive(Debug, Serialize)]
pub(crate) struct CodexServiceStatus {
    api: ServiceHealth,
    cli: ServiceHealth,
}

#[derive(Deserialize)]
struct Component {
    #[serde(default)]
    id: String,
    name: String,
    status: String,
}

#[derive(Deserialize)]
struct Components {
    components: Vec<Component>,
}

#[derive(Debug, thiserror::Error)]
enum StatusError {
    #[error("status request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("status response could not be read: {0}")]
    Read(#[from] std::io::Error),
    #[error("invalid status response: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("status response exceeds the size limit")]
    TooLarge,
}

fn component_health(components: &[Component], id: &str, name: &str) -> ServiceHealth {
    let component = components
        .iter()
        .find(|component| component.id == id)
        .or_else(|| components.iter().find(|component| component.name == name));
    match component.map(|component| component.status.as_str()) {
        Some("operational") => ServiceHealth::Operational,
        Some("degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance") => {
            ServiceHealth::Disrupted
        }
        _ => ServiceHealth::Unknown,
    }
}

fn parse_status(bytes: &[u8]) -> Result<CodexServiceStatus, StatusError> {
    let response: Components = serde_json::from_slice(bytes)?;
    Ok(CodexServiceStatus {
        api: component_health(&response.components, API_ID, "Codex API"),
        cli: component_health(&response.components, CLI_ID, "CLI"),
    })
}

fn fetch_status() -> Result<CodexServiceStatus, StatusError> {
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let response = client.get(STATUS_ENDPOINT).send()?.error_for_status()?;
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(StatusError::TooLarge);
    }
    parse_status(&bytes)
}

/// Network and proxy configuration access run away from the UI thread.
#[tauri::command]
pub(crate) async fn get_codex_service_status() -> Result<CodexServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(fetch_status)
        .await
        .map_err(|_| SAFE_ERROR.to_string())?
        .map_err(|_| SAFE_ERROR.to_string())
}

#[cfg(test)]
#[path = "codex_service_status_tests.rs"]
mod tests;
