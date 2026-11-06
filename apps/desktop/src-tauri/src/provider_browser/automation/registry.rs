use super::{Error, Result, LABEL_PREFIX};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{AppHandle, Listener, Manager};

const MAX_TABS: usize = 32;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Tab {
    pub id: String,
    pub thread_id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    #[serde(skip)]
    pub request_id: String,
    #[serde(skip)]
    initial_url: String,
    #[serde(skip)]
    listener: tauri::EventId,
    #[serde(skip)]
    created_at: Instant,
    #[serde(skip)]
    pub operation: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Default)]
pub(crate) struct State {
    tabs: Mutex<HashMap<String, Tab>>,
    creation: tokio::sync::Mutex<()>,
}

impl State {
    pub(super) fn loading(&self, id: &str, loading: bool) -> Result<()> {
        if let Some(tab) = self
            .tabs
            .lock()
            .map_err(|_| Error::Unavailable)?
            .get_mut(id)
        {
            tab.loading = loading;
        }
        Ok(())
    }
    pub(super) fn get(&self, thread: &str, id: &str) -> Result<Tab> {
        self.tabs
            .lock()
            .map_err(|_| Error::Unavailable)?
            .get(id)
            .filter(|tab| tab.thread_id == thread)
            .cloned()
            .ok_or(Error::Missing)
    }
    pub(super) fn list(&self, thread: &str) -> Result<Value> {
        let mut tabs: Vec<Tab> = self
            .tabs
            .lock()
            .map_err(|_| Error::Unavailable)?
            .values()
            .filter(|tab| tab.thread_id == thread)
            .cloned()
            .collect();
        tabs.sort_by_key(|tab| tab.created_at);
        Ok(json!({"tabs":tabs}))
    }
    pub(super) fn remove(&self, app: &AppHandle, id: &str) -> Result<()> {
        let tab = self.tabs.lock().map_err(|_| Error::Unavailable)?.remove(id);
        if let Some(tab) = tab {
            app.unlisten(tab.listener);
        }
        Ok(())
    }
    pub(super) fn navigated(&self, id: &str, address: String) -> Result<()> {
        if let Some(tab) = self
            .tabs
            .lock()
            .map_err(|_| Error::Unavailable)?
            .get_mut(id)
        {
            tab.url = address;
            if let Ok(url) = url::Url::parse(&tab.url) {
                tab.title = url.host_str().unwrap_or_default().into();
            }
        }
        Ok(())
    }
}

pub(super) async fn open(
    app: &AppHandle,
    thread: &str,
    address: &str,
    request: &str,
) -> Result<Value> {
    let url = super::url(app, address)?;
    let state = app.state::<State>();
    let _creation = state.creation.lock().await;
    if let Some(tab) = existing(&state, thread, request)? {
        if tab.initial_url != address {
            return Err(Error::Invalid);
        }
        super::opened(app, thread, &tab);
        return Ok(json!({"tab":tab,"reused":true}));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let tab = Tab {
        listener: super::events::listen(app, thread, &id),
        id,
        thread_id: thread.into(),
        url: address.into(),
        title: url.host_str().unwrap_or_default().into(),
        loading: true,
        request_id: request.into(),
        initial_url: address.into(),
        created_at: Instant::now(),
        operation: Arc::new(tokio::sync::Mutex::new(())),
    };
    state
        .tabs
        .lock()
        .map_err(|_| Error::Unavailable)?
        .insert(tab.id.clone(), tab.clone());
    let (handle, id) = (app.clone(), tab.id.clone());
    let created = tauri::async_runtime::spawn_blocking(move || create(&handle, &id, url))
        .await
        .map_err(|_| Error::Unavailable)
        .and_then(|result| result);
    if let Err(error) = created {
        state.remove(app, &tab.id)?;
        return Err(error);
    }
    let tab = state.get(thread, &tab.id)?;
    super::opened(app, thread, &tab);
    Ok(json!({"tab":tab}))
}

fn existing(state: &State, thread: &str, request: &str) -> Result<Option<Tab>> {
    let tabs = state.tabs.lock().map_err(|_| Error::Unavailable)?;
    let tab = tabs
        .values()
        .find(|tab| tab.thread_id == thread && tab.request_id == request)
        .cloned();
    if tab.is_none() && tabs.len() >= MAX_TABS {
        return Err(Error::Limit);
    }
    Ok(tab)
}

fn create(app: &AppHandle, id: &str, url: url::Url) -> Result<()> {
    let owner = app.get_webview("main").ok_or(Error::Unavailable)?;
    let builder = super::super::browser_builder(&owner, &format!("{LABEL_PREFIX}{id}"))
        .map_err(|_| Error::Unavailable)?;
    let view = owner
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(-32_768.0, 0.0),
            tauri::LogicalSize::new(1000.0, 700.0),
        )
        .map_err(|_| Error::Unavailable)?;
    let configured =
        super::super::platform::configure(&view, "", &std::collections::BTreeMap::new());
    if configured.is_err() || view.navigate(url).is_err() {
        if let Err(error) = view.close() {
            eprintln!("Browser creation cleanup failed: {error}");
        }
        return Err(Error::Unavailable);
    }
    Ok(())
}
