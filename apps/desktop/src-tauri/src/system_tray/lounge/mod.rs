use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{tray::TrayIcon, Manager, Rect, Runtime, WebviewWindow};
use tokio::sync::{mpsc, watch};

mod icon;
mod popup;
#[cfg(test)]
mod tests;
mod worker;

const LABEL: &str = "lounge-tray";
const REFRESH_EVENT: &str = "lounge-tray-refresh";
const NAVIGATE_EVENT: &str = "lounge-tray-navigate";

#[derive(Clone, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Messages {
    messages: Vec<Message>,
    senders: HashMap<String, Sender>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    key: String,
    sender_id: String,
    sent_at: String,
    text: String,
    image_count: u8,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Sender {
    name: String,
    avatar: Option<String>,
}

#[derive(Clone, Default, Serialize)]
pub(crate) struct Snapshot {
    revision: u64,
    #[serde(flatten)]
    messages: Messages,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum Action {
    Dismiss,
    Ignore,
    ViewAll,
    Open { key: String },
}

enum Event {
    Update(Messages),
    Hover(Rect),
    Dismiss,
    Ready { revision: u64, height: f64 },
    Activate { revision: u64, action: Action },
}

struct TrayState {
    events: mpsc::UnboundedSender<Event>,
    snapshot: watch::Receiver<Arc<Snapshot>>,
    has_messages: Arc<AtomicBool>,
}

pub(super) fn start<R: Runtime>(tray: &TrayIcon<R>) {
    let (events, incoming) = mpsc::unbounded_channel();
    let (snapshots, snapshot) = watch::channel(Arc::new(Snapshot::default()));
    let has_messages = Arc::new(AtomicBool::new(false));
    tray.app_handle().manage(TrayState {
        events,
        snapshot,
        has_messages: has_messages.clone(),
    });
    tauri::async_runtime::spawn(worker::run(tray.clone(), incoming, snapshots, has_messages));
}

pub(super) fn hover<R: Runtime>(tray: &TrayIcon<R>, rect: Rect) {
    let Some(state) = tray.app_handle().try_state::<TrayState>() else {
        return;
    };
    if state.has_messages.load(Ordering::Acquire) && state.events.send(Event::Hover(rect)).is_err()
    {
        eprintln!("lounge tray worker stopped");
    }
}

pub(super) fn dismiss<R: Runtime>(tray: &TrayIcon<R>) {
    let Some(state) = tray.app_handle().try_state::<TrayState>() else {
        return;
    };
    if state.has_messages.load(Ordering::Acquire) && state.events.send(Event::Dismiss).is_err() {
        eprintln!("lounge tray worker stopped");
    }
}

fn caller<'a, R: Runtime>(
    window: &'a WebviewWindow<R>,
    label: &str,
) -> Result<tauri::State<'a, TrayState>, &'static str> {
    if window.label() != label {
        return Err("unexpected lounge tray caller");
    }
    window
        .try_state::<TrayState>()
        .ok_or("lounge tray unavailable")
}

fn send(state: &TrayState, event: Event) -> Result<(), &'static str> {
    state
        .events
        .send(event)
        .map_err(|_| "lounge tray unavailable")
}

#[tauri::command]
pub(crate) async fn lounge_tray_update<R: Runtime>(
    window: WebviewWindow<R>,
    messages: Messages,
) -> Result<(), &'static str> {
    send(caller(&window, "main")?.inner(), Event::Update(messages))
}

#[tauri::command]
pub(crate) async fn lounge_tray_snapshot<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Snapshot, &'static str> {
    let snapshot = caller(&window, LABEL)?.snapshot.borrow().clone();
    Ok((*snapshot).clone())
}

#[tauri::command]
pub(crate) async fn lounge_tray_present<R: Runtime>(
    window: WebviewWindow<R>,
    revision: u64,
    height: f64,
) -> Result<(), &'static str> {
    send(
        caller(&window, LABEL)?.inner(),
        Event::Ready { revision, height },
    )
}

#[tauri::command]
pub(crate) async fn lounge_tray_activate<R: Runtime>(
    window: WebviewWindow<R>,
    revision: u64,
    action: Action,
) -> Result<(), &'static str> {
    send(
        caller(&window, LABEL)?.inner(),
        Event::Activate { revision, action },
    )
}
