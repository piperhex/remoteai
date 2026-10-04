use super::*;

#[derive(Debug, PartialEq)]
enum Recorded {
    Key(u16, bool),
    Lock,
}

fn record(action: KeyboardAction<'_>, events: &mut Vec<Recorded>) -> Result<()> {
    match action {
        KeyboardAction::Key { code, down } => events.push(Recorded::Key(code.code, down)),
        KeyboardAction::Release(keys) => {
            events.extend(keys.iter().map(|key| Recorded::Key(key.code, false)));
        }
        KeyboardAction::Lock => events.push(Recorded::Lock),
    }
    Ok(())
}

fn apply(state: &mut InputState, events: &mut Vec<Recorded>, name: &str, down: bool) {
    let code = KeyboardKey::try_from(name.to_owned()).unwrap();
    state
        .apply_keyboard(code, down, |action| record(action, events))
        .unwrap();
}

#[test]
fn locks_with_either_windows_key_after_releasing_it_without_injecting_l() {
    for (name, windows_key) in [("MetaLeft", VK_LWIN), ("MetaRight", VK_RWIN)] {
        let mut state = InputState::default();
        let mut events = Vec::new();
        apply(&mut state, &mut events, name, true);
        apply(&mut state, &mut events, "KeyL", true);
        assert!(state.held.is_empty());
        assert_eq!(
            events,
            [
                Recorded::Key(windows_key, true),
                Recorded::Key(windows_key, false),
                Recorded::Lock,
            ]
        );
        // Repeats and the remaining key-ups must not affect the newly locked desktop.
        for (code, down) in [("KeyL", true), (name, true), ("KeyL", false), (name, false)] {
            apply(&mut state, &mut events, code, down);
        }
        assert_eq!(events.len(), 3);
        assert!(state.suppressed.is_empty());
        apply(&mut state, &mut events, "KeyL", true);
        apply(&mut state, &mut events, "KeyL", false);
        assert_eq!(
            &events[3..],
            [Recorded::Key(VK_L, true), Recorded::Key(VK_L, false)]
        );
    }
}

#[test]
fn releases_both_windows_keys_and_allows_a_new_lock_chord_after_key_up() {
    let mut state = InputState::default();
    let mut events = Vec::new();
    for _ in 0..2 {
        for name in ["MetaLeft", "MetaRight", "KeyL"] {
            apply(&mut state, &mut events, name, true);
        }
        for name in ["MetaLeft", "KeyL", "MetaRight"] {
            apply(&mut state, &mut events, name, false);
        }
        assert!(state.held.is_empty());
        assert!(state.suppressed.is_empty());
    }
    let chord = [
        Recorded::Key(VK_LWIN, true),
        Recorded::Key(VK_RWIN, true),
        Recorded::Key(VK_LWIN, false),
        Recorded::Key(VK_RWIN, false),
        Recorded::Lock,
    ];
    assert_eq!(&events[..5], chord);
    assert_eq!(&events[5..], chord);
}

#[test]
fn preserves_plain_l_and_unrelated_shortcuts_including_extra_modifiers() {
    for names in [
        vec!["KeyL"],
        vec!["ControlLeft", "KeyL"],
        vec!["MetaLeft", "ControlRight", "KeyL"],
        vec!["MetaLeft", "AltLeft", "KeyL"],
        vec!["MetaLeft", "ShiftRight", "KeyL"],
        vec!["MetaRight", "KeyD"],
        vec!["MetaLeft", "Tab"],
    ] {
        let mut state = InputState::default();
        let mut events = Vec::new();
        let mut expected = Vec::new();
        for (name, down) in names
            .iter()
            .map(|name| (name, true))
            .chain(names.iter().rev().map(|name| (name, false)))
        {
            apply(&mut state, &mut events, name, down);
            expected.push(Recorded::Key(
                KeyboardKey::try_from((*name).to_owned()).unwrap().code,
                down,
            ));
        }
        assert_eq!(events, expected);
        assert!(state.held.is_empty());
        assert!(state.suppressed.is_empty());
    }
}

#[test]
fn retains_held_keys_when_releasing_them_fails_and_does_not_attempt_lock() {
    let mut state = InputState::default();
    let mut events = Vec::new();
    apply(&mut state, &mut events, "MetaLeft", true);
    let code = KeyboardKey::try_from("KeyL".to_owned()).unwrap();
    let result = state.apply_keyboard(code, true, |action| {
        assert!(matches!(action, KeyboardAction::Release(_)));
        Err(DesktopError::Platform)
    });
    assert!(matches!(result, Err(DesktopError::Platform)));
    assert_eq!(state.held.len(), 1);
    assert!(state.suppressed.is_empty());
    apply(&mut state, &mut events, "MetaLeft", false);
    assert!(state.held.is_empty());
}

#[test]
fn reports_lock_failure_without_leaving_keys_held_or_injecting_the_consumed_chord() {
    let mut state = InputState::default();
    let mut events = Vec::new();
    apply(&mut state, &mut events, "MetaLeft", true);
    let code = KeyboardKey::try_from("KeyL".to_owned()).unwrap();
    let result = state.apply_keyboard(code, true, |action| {
        if matches!(action, KeyboardAction::Lock) {
            return Err(DesktopError::Platform);
        }
        record(action, &mut events)
    });
    assert!(matches!(result, Err(DesktopError::Platform)));
    assert!(state.held.is_empty());
    for (name, down) in [("KeyL", true), ("KeyL", false), ("MetaLeft", false)] {
        apply(&mut state, &mut events, name, down);
    }
    assert_eq!(
        events,
        [Recorded::Key(VK_LWIN, true), Recorded::Key(VK_LWIN, false)]
    );
    assert!(state.suppressed.is_empty());
}
