//! Translate the existing physical-key wire format to macOS hardware keycodes.
use super::keyboard::KeyboardKey;

const LETTERS: [u16; 26] = [
    0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16, 6,
];
const DIGITS: [u16; 10] = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];
const NUMPAD: [u16; 10] = [82, 83, 84, 85, 86, 87, 88, 89, 91, 92];
const FUNCTIONS: [u16; 20] = [
    122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
];

pub(super) fn native_key(key: KeyboardKey) -> Option<u16> {
    match key.code {
        0x41..=0x5A => Some(LETTERS[usize::from(key.code - 0x41)]),
        0x30..=0x39 => Some(DIGITS[usize::from(key.code - 0x30)]),
        0x60..=0x69 => Some(NUMPAD[usize::from(key.code - 0x60)]),
        0x70..=0x83 => Some(FUNCTIONS[usize::from(key.code - 0x70)]),
        0x0D => Some(if key.extended { 76 } else { 36 }),
        code => SPECIAL
            .iter()
            .find_map(|&(wire, native)| (wire == code).then_some(native)),
    }
}

const SPECIAL: &[(u16, u16)] = &[
    (0x08, 51),
    (0x09, 48),
    (0x14, 57),
    (0x1B, 53),
    (0x20, 49),
    (0x21, 116),
    (0x22, 121),
    (0x23, 119),
    (0x24, 115),
    (0x25, 123),
    (0x26, 126),
    (0x27, 124),
    (0x28, 125),
    (0x2D, 114),
    (0x2E, 117),
    (0x5B, 55),
    (0x5C, 54),
    (0x6A, 67),
    (0x6B, 69),
    (0x6D, 78),
    (0x6E, 65),
    (0x6F, 75),
    (0x90, 71),
    (0xA0, 56),
    (0xA1, 60),
    (0xA2, 59),
    (0xA3, 62),
    (0xA4, 58),
    (0xA5, 61),
    (0xBA, 41),
    (0xBB, 24),
    (0xBC, 43),
    (0xBD, 27),
    (0xBE, 47),
    (0xBF, 44),
    (0xC0, 50),
    (0xDB, 33),
    (0xDC, 42),
    (0xDD, 30),
    (0xDE, 39),
    (0xE2, 10),
];

pub(super) fn modifier(key: u16) -> u64 {
    match key {
        54 | 55 => 1 << 20, // Command
        56 | 60 => 1 << 17, // Shift
        59 | 62 => 1 << 18, // Control
        58 | 61 => 1 << 19, // Option
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mapped(code: &str) -> Option<u16> {
        native_key(KeyboardKey::try_from(code.to_owned()).unwrap())
    }
    #[test]
    fn maps_command_option_control_and_keypad_without_conflating_them() {
        for (code, expected) in [
            ("KeyC", 8),
            ("MetaLeft", 55),
            ("MetaRight", 54),
            ("AltRight", 61),
            ("ControlLeft", 59),
            ("Enter", 36),
            ("NumpadEnter", 76),
            ("Digit0", 29),
            ("Numpad0", 82),
            ("ArrowUp", 126),
            ("F20", 90),
        ] {
            assert_eq!(mapped(code), Some(expected), "{code}");
        }
        assert_eq!(modifier(55), modifier(54));
        assert_ne!(modifier(55), modifier(59));
        assert_eq!(mapped("F24"), None);
        assert_eq!(mapped("ContextMenu"), None);
    }
}
