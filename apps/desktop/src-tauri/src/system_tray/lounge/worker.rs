use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{image::Image, tray::TrayIcon, Emitter, Manager, Rect, Runtime};
use tokio::{
    sync::{mpsc, watch},
    time::{interval, MissedTickBehavior},
};

use super::{icon, popup, Action, Event, Messages, Snapshot, LABEL, NAVIGATE_EVENT, REFRESH_EVENT};

const FLASH_INTERVAL: Duration = Duration::from_millis(560);
const POINTER_INTERVAL: Duration = Duration::from_millis(50);

struct Worker<R: Runtime> {
    tray: TrayIcon<R>,
    snapshots: watch::Sender<Arc<Snapshot>>,
    has_messages: Arc<AtomicBool>,
    source: Messages,
    ignored: HashSet<String>,
    hover: Option<popup::Hover>,
    ready: Option<(u64, f64)>,
    presented: Option<(u64, f64)>,
    avatar: Option<String>,
    frame: Option<Image<'static>>,
    showing_avatar: bool,
}

pub(super) async fn run<R: Runtime>(
    tray: TrayIcon<R>,
    mut incoming: mpsc::UnboundedReceiver<Event>,
    snapshots: watch::Sender<Arc<Snapshot>>,
    has_messages: Arc<AtomicBool>,
) {
    let mut worker = Worker {
        tray,
        snapshots,
        has_messages,
        source: Messages::default(),
        ignored: HashSet::new(),
        hover: None,
        ready: None,
        presented: None,
        avatar: None,
        frame: None,
        showing_avatar: false,
    };
    let mut flash = interval(FLASH_INTERVAL);
    let mut pointer = interval(POINTER_INTERVAL);
    flash.set_missed_tick_behavior(MissedTickBehavior::Delay);
    pointer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            event = incoming.recv() => {
                let Some(event) = event else { break };
                if worker.handle(event) { flash.reset(); }
            }
            _ = flash.tick(), if worker.frame.is_some() => worker.flash(),
            _ = pointer.tick(), if worker.hover.is_some() => worker.check_pointer(),
        }
    }
}

impl<R: Runtime> Worker<R> {
    fn handle(&mut self, event: Event) -> bool {
        match event {
            Event::Update(source) => return self.update(source),
            Event::Hover(rect) => self.hover(rect),
            Event::Dismiss => self.dismiss(),
            Event::Ready { revision, height } => {
                if height.is_finite() && revision == self.snapshots.borrow().revision {
                    self.ready = Some((revision, height));
                }
            }
            Event::Activate { revision, action } => return self.activate(revision, action),
        }
        false
    }

    fn update(&mut self, source: Messages) -> bool {
        let pending: HashSet<_> = source
            .messages
            .iter()
            .map(|message| message.key.as_str())
            .collect();
        self.ignored.retain(|key| pending.contains(key.as_str()));
        self.source = source;
        self.publish()
    }

    fn publish(&mut self) -> bool {
        let mut messages = self.source.clone();
        messages
            .messages
            .retain(|message| !self.ignored.contains(&message.key));
        let active: HashSet<_> = messages
            .messages
            .iter()
            .map(|message| message.sender_id.as_str())
            .collect();
        messages
            .senders
            .retain(|id, _| active.contains(id.as_str()));
        let previous = self.snapshots.borrow().clone();
        if messages == previous.messages {
            return false;
        }
        let avatar = messages
            .messages
            .first()
            .and_then(|message| messages.senders.get(&message.sender_id))
            .and_then(|sender| sender.avatar.clone());
        let unread = !messages.messages.is_empty();
        self.snapshots.send_replace(Arc::new(Snapshot {
            revision: previous.revision + 1,
            messages,
        }));
        let had_unread = self.has_messages.swap(unread, Ordering::AcqRel);
        self.ready = None;
        if !unread {
            self.clear_hover();
        }
        if let Some(window) = self.tray.app_handle().get_webview_window(LABEL) {
            report(window.emit(REFRESH_EVENT, ()));
        }
        if unread && !had_unread {
            self.hover_if_under_cursor();
        }
        self.update_icon(unread, avatar)
    }

    fn update_icon(&mut self, unread: bool, avatar: Option<String>) -> bool {
        if unread {
            if self.frame.is_some() && self.avatar == avatar {
                return false;
            }
            let frame = icon::avatar(avatar.as_deref());
            self.avatar = avatar;
            self.frame = Some(frame.clone());
            self.showing_avatar = true;
            report(self.tray.set_tooltip(None::<&str>));
            report(self.tray.set_icon(Some(frame)));
        } else {
            self.avatar = None;
            self.frame = None;
            self.showing_avatar = false;
            report(self.tray.set_icon(Some(icon::normal())));
            report(self.tray.set_tooltip(Some("Remote AI")));
        }
        true
    }

    fn flash(&mut self) {
        // Explorer can skip movement callbacks for an icon in the overflow area.
        if self.hover.is_none() {
            self.hover_if_under_cursor();
        }
        self.showing_avatar = !self.showing_avatar;
        let frame = if self.showing_avatar {
            self.frame.clone()
        } else {
            Some(icon::normal())
        };
        report(self.tray.set_icon(frame));
    }

    fn hover_if_under_cursor(&mut self) {
        if let (Ok(Some(rect)), Ok(cursor)) =
            (self.tray.rect(), self.tray.app_handle().cursor_position())
        {
            if popup::Bounds::new(rect).contains(cursor) {
                self.hover(rect);
            }
        }
    }

    fn hover(&mut self, rect: Rect) {
        if !self.has_messages.load(Ordering::Acquire) {
            return;
        }
        if let Some(hover) = &mut self.hover {
            hover.anchor = popup::Bounds::new(rect);
        } else {
            self.hover = Some(popup::Hover::new(rect));
        }
    }

    fn check_pointer(&mut self) {
        let app = self.tray.app_handle();
        let (Some(hover), Ok(cursor)) = (&mut self.hover, app.cursor_position()) else {
            return;
        };
        if hover.exited(cursor) {
            self.clear_hover();
            return;
        }
        if hover.suppressed || !hover.dwell_elapsed() {
            return;
        }
        let Some(window) = app.get_webview_window(LABEL) else {
            if let Err(error) = popup::create(app) {
                eprintln!("failed to create lounge tray: {error}");
                self.dismiss();
            }
            return;
        };
        let Some(ready) = self.ready else { return };
        if self.presented == Some(ready) {
            return;
        }
        match popup::present(&window, hover.anchor, ready.1) {
            Ok(surface) => {
                hover.surface = surface;
                self.presented = Some(ready);
            }
            Err(error) => {
                eprintln!("failed to position lounge tray: {error}");
                self.dismiss();
            }
        }
    }

    fn dismiss(&mut self) {
        if let Some(hover) = &mut self.hover {
            hover.suppressed = true;
            hover.surface = None;
        }
        self.hide();
    }

    fn clear_hover(&mut self) {
        self.hover = None;
        self.hide();
    }

    fn hide(&mut self) {
        if self.presented.take().is_some() {
            report(popup::hide(self.tray.app_handle()));
        }
    }

    fn activate(&mut self, revision: u64, action: Action) -> bool {
        let snapshot = self.snapshots.borrow().clone();
        match action {
            Action::Dismiss => self.dismiss(),
            Action::Ignore if snapshot.revision == revision => {
                self.ignored.extend(
                    snapshot
                        .messages
                        .messages
                        .iter()
                        .map(|message| message.key.clone()),
                );
                self.dismiss();
                return self.publish();
            }
            Action::Open { key }
                if snapshot
                    .messages
                    .messages
                    .iter()
                    .any(|message| message.key == key) =>
            {
                self.navigate(Some(key));
            }
            Action::ViewAll if !snapshot.messages.messages.is_empty() => self.navigate(None),
            _ => {}
        }
        false
    }

    fn navigate(&mut self, key: Option<String>) {
        self.dismiss();
        let app = self.tray.app_handle();
        if let Some(window) = app.get_webview("main") {
            report(window.emit(NAVIGATE_EVENT, key));
        }
        super::super::show_dashboard(app);
    }
}

fn report(result: tauri::Result<()>) {
    if let Err(error) = result {
        eprintln!("failed to update lounge tray: {error}");
    }
}
