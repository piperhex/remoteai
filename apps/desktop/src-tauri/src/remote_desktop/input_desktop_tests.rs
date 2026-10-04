use super::*;
use std::mem::size_of;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

fn harmless_inputs() -> [INPUT; 2] {
    [
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                // Zero relative movement exercises injection without moving the cursor.
                mi: MOUSEINPUT {
                    dwFlags: MOUSEEVENTF_MOVE,
                    ..Default::default()
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                // Only release an unused key; never type into the user's focused field.
                ki: KEYBDINPUT {
                    wVk: VK_F24,
                    dwFlags: KEYEVENTF_KEYUP,
                    ..Default::default()
                },
            },
        },
    ]
}

#[test]
#[ignore = "requires an interactive Windows desktop, or SYSTEM on the console sign-in desktop"]
fn bound_desktop_accepts_mouse_and_keyboard_input_and_restores_thread() {
    // A fresh thread has no windows/hooks that would prevent changing its desktop.
    std::thread::spawn(|| {
        // SAFETY: the returned handle is borrowed from this test thread and remains live throughout it.
        let previous = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
        {
            let _desktop = InputDesktop::bind().expect("bind the active input desktop");
            for event in harmless_inputs() {
                // SAFETY: event is initialized and its ABI size matches INPUT on this target.
                let sent = unsafe { SendInput(1, &event, size_of::<INPUT>() as i32) };
                assert_eq!(
                    sent,
                    1,
                    "input rejected: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
        // SAFETY: querying the same live test thread after the binding scope has been dropped.
        assert_eq!(unsafe { GetThreadDesktop(GetCurrentThreadId()) }, previous);
    })
    .join()
    .expect("desktop input regression");
}
