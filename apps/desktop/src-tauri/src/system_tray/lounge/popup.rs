use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, Runtime, WebviewWindow};
use tokio::time::Instant;

use super::LABEL;

const WIDTH: f64 = 350.0;
const MIN_HEIGHT: f64 = 100.0;
const MAX_HEIGHT: f64 = 420.0;
const EDGE_GAP: f64 = 6.0;
const DWELL: Duration = Duration::from_millis(300);
const EXIT_GRACE: Duration = Duration::from_millis(350);

#[derive(Clone, Copy, Debug)]
pub(super) struct Bounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    pub(super) fn new(rect: Rect) -> Self {
        let position = rect.position.to_physical::<f64>(1.0);
        let size = rect.size.to_physical::<f64>(1.0);
        Self {
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
        }
    }

    pub(super) fn contains(self, cursor: PhysicalPosition<f64>) -> bool {
        (self.left..self.left + self.width).contains(&cursor.x)
            && (self.top..self.top + self.height).contains(&cursor.y)
    }

    fn center(self) -> PhysicalPosition<f64> {
        PhysicalPosition::new(self.left + self.width / 2.0, self.top + self.height / 2.0)
    }
}

pub(super) struct Hover {
    pub(super) anchor: Bounds,
    pub(super) surface: Option<Bounds>,
    pub(super) suppressed: bool,
    entered: Instant,
    outside: Option<Instant>,
}

impl Hover {
    pub(super) fn new(rect: Rect) -> Self {
        Self {
            anchor: Bounds::new(rect),
            surface: None,
            suppressed: false,
            entered: Instant::now(),
            outside: None,
        }
    }

    pub(super) fn dwell_elapsed(&self) -> bool {
        self.entered.elapsed() >= DWELL
    }

    pub(super) fn exited(&mut self, cursor: PhysicalPosition<f64>) -> bool {
        if self.anchor.contains(cursor)
            || self.surface.is_some_and(|bounds| bounds.contains(cursor))
        {
            self.outside = None;
            return false;
        }
        if self.suppressed || self.surface.is_none() {
            return true;
        }
        self.outside.get_or_insert_with(Instant::now).elapsed() >= EXIT_GRACE
    }
}

pub(super) fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    crate::webview_windows::builder(
        app,
        LABEL,
        tauri::WebviewUrl::App("lounge-tray.html#lounge-tray".into()),
    )
    .title("Remote AI")
    .inner_size(WIDTH, MAX_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .visible(false)
    .build()?;
    Ok(())
}

pub(super) fn present<R: Runtime>(
    window: &WebviewWindow<R>,
    anchor: Bounds,
    height: f64,
) -> tauri::Result<Option<Bounds>> {
    let center = anchor.center();
    let Some(monitor) = window
        .monitor_from_point(center.x, center.y)?
        .or(window.primary_monitor()?)
    else {
        return Ok(None);
    };
    let work = monitor.work_area();
    let area = Bounds {
        left: f64::from(work.position.x),
        top: f64::from(work.position.y),
        width: f64::from(work.size.width),
        height: f64::from(work.size.height),
    };
    let surface = place(anchor, area, height, monitor.scale_factor());
    let position = PhysicalPosition::new(surface.left.round() as i32, surface.top.round() as i32);
    let size = PhysicalSize::new(surface.width.round() as u32, surface.height.round() as u32);
    window.set_position(position)?;
    window.set_size(size)?;
    // The window is built with focused(false) so Windows shows it without activating it.
    window.show()?;
    Ok(Some(surface))
}

pub(super) fn hide<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide()?;
    }
    Ok(())
}

fn place(anchor: Bounds, area: Bounds, height: f64, scale: f64) -> Bounds {
    let gap = EDGE_GAP * scale;
    let width = (WIDTH * scale).min(area.width - gap * 2.0).max(1.0);
    let height = (height.clamp(MIN_HEIGHT, MAX_HEIGHT) * scale)
        .min(area.height - gap * 2.0)
        .max(1.0);
    let center = anchor.center();
    let bottom = area.top + area.height;
    let right = area.left + area.width;
    let (left, top) = if center.x < area.left {
        (area.left + gap, center.y - height / 2.0)
    } else if center.x >= right {
        (right - gap - width, center.y - height / 2.0)
    } else if center.y < area.top || anchor.top - height < area.top {
        (center.x - width / 2.0, anchor.top + anchor.height + gap)
    } else {
        (center.x - width / 2.0, anchor.top - gap - height)
    };
    Bounds {
        left: left.clamp(area.left + gap, (right - gap - width).max(area.left + gap)),
        top: top.clamp(area.top + gap, (bottom - gap - height).max(area.top + gap)),
        width,
        height,
    }
}
