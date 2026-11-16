//! Only the isolated test builder registers these commands; no account, helper or cloud setup runs.
use super::{bulk::ManifestRead, StreamClose, StreamOpen};
use serde_json::{json, Value};
use std::sync::Arc;

#[tauri::command]
pub(crate) async fn native_rtc_file_fixture_open(
    state: tauri::State<'_, super::super::GuiState>,
    run: u32,
) -> Result<Value, String> {
    let streams = Arc::clone(&state.downloads.0);
    let root = std::path::PathBuf::from(std::env::var_os("NATIVE_RTC_FIXTURES").unwrap());
    let transfer = uuid::Uuid::new_v4().to_string();
    let owner = transfer.clone();
    let files = streams.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        files
            .insert(
                root,
                StreamOpen {
                    thread_id: owner,
                    path: "encrypted-benchmark.bin".into(),
                    max_bytes: 128 * 1024 * 1024,
                },
            )
            .unwrap()
    })
    .await
    .unwrap();
    let read = |page| ManifestRead {
        thread_id: transfer.clone(),
        id: info.id.clone(),
        max_bytes: info.size,
        page,
    };
    let manifest = streams.clone().manifest(read(None)).await.unwrap().data;
    let page = streams.manifest(read(Some(0))).await.unwrap().data;
    Ok(
        json!({"id":info.id,"transfer":transfer,"epoch":uuid::Uuid::new_v4(),"manifest":manifest,
        "page":page,"key":"07".repeat(32),"run":run}),
    )
}

#[tauri::command]
pub(crate) async fn native_rtc_file_fixture_close(
    state: tauri::State<'_, super::super::GuiState>,
    id: String,
    transfer: String,
) -> Result<(), String> {
    let streams = Arc::clone(&state.downloads.0);
    tauri::async_runtime::spawn_blocking(move || {
        streams
            .remove(StreamClose {
                id,
                thread_id: transfer,
            })
            .unwrap()
    })
    .await
    .unwrap();
    Ok(())
}
