//! Isolated, random diagnostic bundles. Never registered in the production command handler.
use super::tests::Bundles;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub(crate) struct Fixtures(Arc<Mutex<HashMap<String, Bundles>>>);

#[tauri::command]
pub(crate) async fn native_sync_fixture_open(
    state: tauri::State<'_, Fixtures>,
    mib: usize,
) -> Result<Value, String> {
    if !(1..=128).contains(&mib) {
        return Err("invalid fixture size".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut fixtures = state.0.lock().map_err(|error| error.to_string())?;
        if fixtures.len() >= 2 {
            return Err("fixture limit".into());
        }
        let bundles = Bundles::new(mib * 1024 * 1024);
        let id = uuid::Uuid::new_v4().to_string();
        let transfers = super::super::TRANSFERS
            .lock()
            .map_err(|error| error.to_string())?;
        let source =
            super::super::persistence::description(&bundles.source, &transfers[&bundles.source])?;
        let destination = super::super::persistence::description(
            &bundles.destination,
            &transfers[&bundles.destination],
        )?;
        fixtures.insert(id.clone(), bundles);
        Ok(json!({ "id": id, "source": source, "destination": destination }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn native_sync_fixture_finish(
    state: tauri::State<'_, Fixtures>,
    id: String,
    verify: bool,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut fixtures = state.0.lock().map_err(|error| error.to_string())?;
        let bundles = fixtures.remove(&id).ok_or("fixture not found")?;
        if verify {
            super::super::binary::verify(&bundles.destination)?;
        }
        drop(bundles);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn native_sync_fixture_verify(
    state: tauri::State<'_, Fixtures>,
    id: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let fixtures = state.0.lock().map_err(|error| error.to_string())?;
        let bundles = fixtures.get(&id).ok_or("fixture not found")?;
        super::super::binary::verify(&bundles.destination)
    })
    .await
    .map_err(|error| error.to_string())?
}
