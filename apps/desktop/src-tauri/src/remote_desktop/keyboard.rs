use super::DesktopError;
use serde::Deserialize;

/// Validated physical key in the original wire mapping; macOS translates it to a Quartz keycode.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(try_from = "String")]
pub(crate) struct KeyboardKey {
    pub code: u16,
    pub extended: bool,
}

const SPECIAL_KEYS: &[(&str, u16, bool)] = &[
    ("Backspace", 0x08, false),
    ("Tab", 0x09, false),
    ("Enter", 0x0D, false),
    ("Pause", 0x13, false),
    ("CapsLock", 0x14, false),
    ("Escape", 0x1B, false),
    ("Space", 0x20, false),
    ("PageUp", 0x21, true),
    ("PageDown", 0x22, true),
    ("End", 0x23, true),
    ("Home", 0x24, true),
    ("ArrowLeft", 0x25, true),
    ("ArrowUp", 0x26, true),
    ("ArrowRight", 0x27, true),
    ("ArrowDown", 0x28, true),
    ("PrintScreen", 0x2C, true),
    ("Insert", 0x2D, true),
    ("Delete", 0x2E, true),
    ("MetaLeft", 0x5B, true),
    ("MetaRight", 0x5C, true),
    ("ContextMenu", 0x5D, true),
    ("NumpadMultiply", 0x6A, false),
    ("NumpadAdd", 0x6B, false),
    ("NumpadSubtract", 0x6D, false),
    ("NumpadDecimal", 0x6E, false),
    ("NumpadDivide", 0x6F, true),
    ("NumpadEnter", 0x0D, true),
    ("NumLock", 0x90, true),
    ("ScrollLock", 0x91, false),
    ("ShiftLeft", 0xA0, false),
    ("ShiftRight", 0xA1, false),
    ("ControlLeft", 0xA2, false),
    ("ControlRight", 0xA3, true),
    ("AltLeft", 0xA4, false),
    ("AltRight", 0xA5, true),
    ("Semicolon", 0xBA, false),
    ("Equal", 0xBB, false),
    ("Comma", 0xBC, false),
    ("Minus", 0xBD, false),
    ("Period", 0xBE, false),
    ("Slash", 0xBF, false),
    ("Backquote", 0xC0, false),
    ("BracketLeft", 0xDB, false),
    ("Backslash", 0xDC, false),
    ("BracketRight", 0xDD, false),
    ("Quote", 0xDE, false),
    ("IntlBackslash", 0xE2, false),
];

impl TryFrom<String> for KeyboardKey {
    type Error = DesktopError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if let Some((_, code, extended)) = SPECIAL_KEYS.iter().find(|(name, _, _)| *name == value) {
            return Ok(Self {
                code: *code,
                extended: *extended,
            });
        }
        let code = ranged_key(&value).ok_or(DesktopError::Invalid)?;
        Ok(Self {
            code,
            extended: false,
        })
    }
}

fn ranged_key(value: &str) -> Option<u16> {
    for (prefix, start, end, base) in [
        ("Key", b'A', b'Z', 0x41),
        ("Digit", b'0', b'9', 0x30),
        ("Numpad", b'0', b'9', 0x60),
    ] {
        let Some(suffix) = value.strip_prefix(prefix) else {
            continue;
        };
        let bytes = suffix.as_bytes();
        if bytes.len() == 1 && (start..=end).contains(&bytes[0]) {
            return Some(base + u16::from(bytes[0] - start));
        }
    }
    let function = value.strip_prefix('F')?.parse::<u16>().ok()?;
    (1..=24).contains(&function).then_some(0x70 + function - 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_physical_keys_and_rejects_unknown_codes() {
        assert_eq!(KeyboardKey::try_from("KeyA".to_owned()).unwrap().code, 0x41);
        assert_eq!(KeyboardKey::try_from("F24".to_owned()).unwrap().code, 0x87);
        assert!(
            KeyboardKey::try_from("ControlRight".to_owned())
                .unwrap()
                .extended
        );
        assert!(
            KeyboardKey::try_from("NumpadEnter".to_owned())
                .unwrap()
                .extended
        );
        for code in ["", "KeyAA", "F0", "F25", "LaunchApplication1"] {
            assert!(KeyboardKey::try_from(code.to_owned()).is_err());
        }
    }
}
