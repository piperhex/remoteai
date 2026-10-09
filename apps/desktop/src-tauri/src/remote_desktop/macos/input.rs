use super::super::{macos_keymap, Button, DesktopInput, Key, Result};
use super::{
    events,
    monitors::{Monitor, Point},
};
use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

#[derive(Default)]
pub(in crate::remote_desktop) struct InputState {
    keys: BTreeSet<u16>,
    buttons: BTreeSet<u32>,
    click: Option<(u32, Point, Instant, i64)>,
    caps_lock: bool,
}

impl InputState {
    pub(in crate::remote_desktop) fn apply(
        &mut self,
        input: DesktopInput,
        display: &Monitor,
    ) -> Result<()> {
        super::authorize(true)?;
        match input {
            DesktopInput::Move { x, y } => {
                let (x, y) = display.refresh()?.bounds.point(x, y);
                let (kind, button) = match self.buttons.first() {
                    Some(0) => (6, 0),
                    Some(1) => (7, 1),
                    Some(_) => (27, 2),
                    None => (5, 0),
                };
                events::mouse(
                    kind,
                    Point {
                        x: f64::from(x),
                        y: f64::from(y),
                    },
                    button,
                    (self.flags(), 0),
                )
            }
            DesktopInput::Button { button, down } => self.button(button_number(button), down),
            DesktopInput::Wheel { delta, horizontal } => {
                events::wheel(delta, horizontal, self.flags())
            }
            DesktopInput::Text { text } => events::text(&text),
            DesktopInput::Key { key } => self.shortcut(key),
            DesktopInput::Keyboard { code, down } => {
                // Windows-only keys have no macOS equivalent; ignore them without ending the session.
                let Some(code) = macos_keymap::native_key(code) else {
                    return Ok(());
                };
                self.key(code, down)
            }
        }
    }

    fn flags(&self) -> u64 {
        const CAPS_LOCK_FLAG: u64 = 1 << 16;
        let initial = if self.caps_lock { CAPS_LOCK_FLAG } else { 0 };
        self.keys
            .iter()
            .fold(initial, |flags, &key| flags | macos_keymap::modifier(key))
    }

    fn key(&mut self, code: u16, down: bool) -> Result<()> {
        const CAPS_LOCK_KEY: u16 = 57;
        let held = self.keys.contains(&code);
        let caps_lock = self.caps_lock;
        if code == CAPS_LOCK_KEY && down && !self.keys.contains(&code) {
            self.caps_lock = !self.caps_lock;
        }
        if down {
            self.keys.insert(code);
        } else {
            self.keys.remove(&code);
        }
        if let Err(error) = events::key(code, down, self.flags()) {
            if held {
                self.keys.insert(code);
            } else {
                self.keys.remove(&code);
            }
            self.caps_lock = caps_lock;
            return Err(error);
        }
        Ok(())
    }

    fn button(&mut self, button: u32, down: bool) -> Result<()> {
        let point = events::location()?;
        let count = if down {
            self.click_count(button, point)
        } else {
            self.click.as_ref().map_or(1, |click| click.3)
        };
        let kind = match (button, down) {
            (0, true) => 1,
            (0, false) => 2,
            (1, true) => 3,
            (1, false) => 4,
            (_, true) => 25,
            (_, false) => 26,
        };
        events::mouse(kind, point, button, (self.flags(), count))?;
        if down {
            self.buttons.insert(button);
        } else {
            self.buttons.remove(&button);
        }
        Ok(())
    }

    fn click_count(&mut self, button: u32, point: Point) -> i64 {
        const DOUBLE_CLICK: Duration = Duration::from_millis(500);
        const CLICK_DISTANCE: f64 = 4.0;
        let count = self
            .click
            .as_ref()
            .filter(|(previous, origin, at, _)| {
                *previous == button
                    && at.elapsed() <= DOUBLE_CLICK
                    && (origin.x - point.x).abs() <= CLICK_DISTANCE
                    && (origin.y - point.y).abs() <= CLICK_DISTANCE
            })
            .map_or(1, |click| (click.3 + 1).min(3));
        self.click = Some((button, point, Instant::now(), count));
        count
    }

    pub(in crate::remote_desktop) fn release(&mut self) -> Result<()> {
        // Release only keys/buttons held by this session; leave local user input alone.
        for button in self.buttons.clone() {
            self.button(button, false)?;
        }
        for code in self.keys.clone() {
            self.key(code, false)?;
        }
        self.click = None;
        Ok(())
    }

    fn shortcut(&mut self, key: Key) -> Result<()> {
        match key {
            Key::Enter => self.chord(&[36]),
            Key::Backspace => self.chord(&[51]),
            Key::Escape => self.chord(&[53]),
            Key::Tab => self.chord(&[48]),
            Key::Desktop => self.chord(&[103]), // F11: Show Desktop.
            Key::Windows => self.chord(&[59, 126]), // Control+Up: Mission Control.
        }
    }

    pub(in crate::remote_desktop) fn chord(&mut self, codes: &[u16]) -> Result<()> {
        super::authorize(true)?;
        self.release()?;
        let result = codes.iter().try_for_each(|&code| self.key(code, true));
        let cleanup = codes
            .iter()
            .rev()
            .try_for_each(|&code| self.key(code, false));
        result.and(cleanup)
    }
}

fn button_number(button: Button) -> u32 {
    match button {
        Button::Left => 0,
        Button::Right => 1,
        Button::Middle => 2,
    }
}
