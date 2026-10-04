use super::{keyboard::KeyboardKey, Button, DesktopError, DesktopInput, Key, Result};
use std::{collections::BTreeSet, mem::size_of};
use windows_sys::Win32::System::Shutdown::LockWorkStation;
use windows_sys::Win32::UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*};

fn mouse(flags: u32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dwFlags: flags,
                mouseData: data,
                ..Default::default()
            },
        },
    }
}
fn key(code: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}
fn send(inputs: &[INPUT]) -> Result<()> {
    // SAFETY: the slice is fully initialized and its ABI size matches INPUT for this target.
    let count = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if count != inputs.len() as u32 {
        return Err(DesktopError::Platform);
    }
    Ok(())
}
#[derive(Default)]
pub(super) struct InputState {
    held: BTreeSet<KeyboardKey>,
    suppressed: BTreeSet<KeyboardKey>,
}
impl InputState {
    pub(super) fn release(&mut self) -> Result<()> {
        let mut inputs = vec![
            mouse(MOUSEEVENTF_LEFTUP, 0),
            mouse(MOUSEEVENTF_RIGHTUP, 0),
            mouse(MOUSEEVENTF_MIDDLEUP, 0),
        ];
        inputs.extend(self.held.iter().map(|code| physical_key(*code, false)));
        send(&inputs)?;
        self.held.clear();
        self.suppressed.clear();
        Ok(())
    }
    pub(super) fn apply(
        &mut self,
        input: DesktopInput,
        display: &super::monitors::Monitor,
    ) -> Result<()> {
        if let DesktopInput::Keyboard { code, down } = input {
            return self.apply_keyboard(code, down, keyboard_action);
        }
        input_event(input, display)
    }

    fn apply_keyboard(
        &mut self,
        code: KeyboardKey,
        down: bool,
        mut execute: impl FnMut(KeyboardAction<'_>) -> Result<()>,
    ) -> Result<()> {
        if self.suppressed.contains(&code) {
            if !down {
                self.suppressed.remove(&code);
            }
            return Ok(());
        }
        if down && code.code == VK_L && self.only_windows_keys_held() {
            // Win+L cannot be implemented by SendInput. Release before switching desktops,
            // then consume this chord's repeats/key-ups so they cannot reach the sign-in screen.
            execute(KeyboardAction::Release(&self.held))?;
            self.suppressed.extend(std::mem::take(&mut self.held));
            self.suppressed.insert(code);
            return execute(KeyboardAction::Lock);
        }
        execute(KeyboardAction::Key { code, down })?;
        if down {
            self.held.insert(code);
        } else {
            self.held.remove(&code);
        }
        Ok(())
    }

    fn only_windows_keys_held(&self) -> bool {
        !self.held.is_empty()
            && self
                .held
                .iter()
                .all(|key| matches!(key.code, VK_LWIN | VK_RWIN))
    }
}

enum KeyboardAction<'a> {
    Key { code: KeyboardKey, down: bool },
    Release(&'a BTreeSet<KeyboardKey>),
    Lock,
}

fn keyboard_action(action: KeyboardAction<'_>) -> Result<()> {
    match action {
        KeyboardAction::Key { code, down } => send(&[physical_key(code, down)]),
        KeyboardAction::Release(keys) => send(
            &keys
                .iter()
                .map(|code| physical_key(*code, false))
                .collect::<Vec<_>>(),
        ),
        KeyboardAction::Lock => {
            // SAFETY: this parameterless API runs on the authorized session's input worker,
            // which is attached to the interactive desktop by with_session.
            if unsafe { LockWorkStation() } == 0 {
                return Err(DesktopError::Platform);
            }
            Ok(())
        }
    }
}

fn physical_key(code: KeyboardKey, down: bool) -> INPUT {
    let extended = if code.extended {
        KEYEVENTF_EXTENDEDKEY
    } else {
        0
    };
    key(code.code, extended | if down { 0 } else { KEYEVENTF_KEYUP })
}

fn input_event(input: DesktopInput, display: &super::monitors::Monitor) -> Result<()> {
    let _dpi = super::monitors::PhysicalPixels::enter()?;
    let bounds = display.refresh()?.bounds;
    match input {
        DesktopInput::Move { x, y } => {
            let (x, y) = bounds.point(x, y);
            // SAFETY: coordinates map validated normalized input to the selected live display.
            let moved = unsafe { SetCursorPos(x, y) };
            if moved == 0 {
                return Err(DesktopError::Platform);
            }
            Ok(())
        }
        DesktopInput::Button { button, down } => {
            let flags = match (button, down) {
                (Button::Left, true) => MOUSEEVENTF_LEFTDOWN,
                (Button::Left, false) => MOUSEEVENTF_LEFTUP,
                (Button::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                (Button::Right, false) => MOUSEEVENTF_RIGHTUP,
                (Button::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                (Button::Middle, false) => MOUSEEVENTF_MIDDLEUP,
            };
            send(&[mouse(flags, 0)])
        }
        DesktopInput::Wheel { delta, horizontal } => {
            let flags = if horizontal {
                MOUSEEVENTF_HWHEEL
            } else {
                MOUSEEVENTF_WHEEL
            };
            send(&[mouse(flags, delta as u32)])
        }
        DesktopInput::Text { text } => text_input(&text),
        DesktopInput::Key { key: value } => shortcut(value),
        DesktopInput::Keyboard { .. } => Err(DesktopError::Invalid),
    }
}
fn text_input(text: &str) -> Result<()> {
    let mut inputs = Vec::new();
    for character in text.encode_utf16() {
        for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wScan: character,
                        dwFlags: flags,
                        ..Default::default()
                    },
                },
            });
        }
    }
    if inputs.is_empty() {
        return Ok(());
    }
    send(&inputs)
}
fn shortcut(value: Key) -> Result<()> {
    let code = match value {
        Key::Enter => VK_RETURN,
        Key::Backspace => VK_BACK,
        Key::Escape => VK_ESCAPE,
        Key::Tab => VK_TAB,
        Key::Desktop => 0x44,
        Key::Windows => VK_TAB,
    };
    if matches!(value, Key::Desktop | Key::Windows) {
        return send(&[
            key(VK_LWIN, 0),
            key(code, 0),
            key(code, KEYEVENTF_KEYUP),
            key(VK_LWIN, KEYEVENTF_KEYUP),
        ]);
    }
    send(&[key(code, 0), key(code, KEYEVENTF_KEYUP)])
}

pub(super) fn clipboard_shortcut(code: u16) -> Result<()> {
    send(&[
        key(VK_CONTROL, 0),
        key(code, 0),
        key(code, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ])
}

#[cfg(test)]
#[path = "windows_input_tests.rs"]
mod tests;
