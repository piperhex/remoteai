//! Opt-in hardware regression: observe Windows power events, not command acknowledgements.
#![cfg(windows)]

#[path = "../src/platform/screen_power.rs"]
mod screen_power;

use std::{
    ffi::c_void,
    sync::atomic::{AtomicU32, Ordering},
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::GUID,
    Win32::{
        Foundation::HANDLE,
        System::Power::{
            PowerSettingRegisterNotification, PowerSettingUnregisterNotification,
            SetThreadExecutionState, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, ES_DISPLAY_REQUIRED,
            HPOWERNOTIFY, POWERBROADCAST_SETTING,
        },
        UI::WindowsAndMessaging::{DEVICE_NOTIFY_CALLBACK, PBT_POWERSETTINGCHANGE},
    },
};

const CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(0x6fe69556_704a_47a0_8f24_c28d936fda47);
const DISPLAY_OFF: u32 = 0;
const DISPLAY_ON: u32 = 1;
const UNKNOWN: u32 = u32::MAX;
const TRANSITION_TIMEOUT: Duration = Duration::from_secs(5);
const RESTORE_OBSERVATION: Duration = Duration::from_secs(30);
static DISPLAY_STATE: AtomicU32 = AtomicU32::new(UNKNOWN);
static OFF_EVENTS: AtomicU32 = AtomicU32::new(0);
static AWAKE_EVENTS: AtomicU32 = AtomicU32::new(0);

unsafe extern "system" fn on_power_change(
    _context: *const c_void,
    kind: u32,
    setting: *const c_void,
) -> u32 {
    if kind != PBT_POWERSETTINGCHANGE || setting.is_null() {
        return 0;
    }
    // SAFETY: Windows provides a POWERBROADCAST_SETTING for this notification. Read
    // the trailing DWORD only after validating its length; it need not be aligned.
    let setting = unsafe { &*setting.cast::<POWERBROADCAST_SETTING>() };
    if setting.PowerSetting != CONSOLE_DISPLAY_STATE || setting.DataLength != 4 {
        return 0;
    }
    // SAFETY: The validated notification contains all four bytes at Data.
    let state = unsafe { setting.Data.as_ptr().cast::<u32>().read_unaligned() };
    DISPLAY_STATE.store(state, Ordering::SeqCst);
    println!("display-state={state}");
    if state == DISPLAY_OFF {
        OFF_EVENTS.fetch_add(1, Ordering::SeqCst);
    } else {
        AWAKE_EVENTS.fetch_add(1, Ordering::SeqCst);
    }
    0
}

struct PowerObserver(HPOWERNOTIFY);

impl PowerObserver {
    fn new() -> Self {
        let parameters = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power_change),
            Context: std::ptr::null_mut(),
        };
        let mut registration = std::ptr::null_mut();
        // SAFETY: Registration copies the callback descriptor. The callback and
        // its atomic storage live for the entire test process and use no context.
        let result = unsafe {
            PowerSettingRegisterNotification(
                &CONSOLE_DISPLAY_STATE,
                DEVICE_NOTIFY_CALLBACK,
                HANDLE(
                    (&parameters as *const DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS)
                        .cast_mut()
                        .cast(),
                ),
                &mut registration,
            )
        };
        assert_eq!(result.0, 0, "power observer registration failed");
        Self(HPOWERNOTIFY(registration as isize))
    }
}

impl Drop for PowerObserver {
    fn drop(&mut self) {
        // SAFETY: This handle belongs to this observer and is unregistered once.
        let result = unsafe { PowerSettingUnregisterNotification(self.0) };
        if result.0 != 0 {
            eprintln!("power observer cleanup failed: {}", result.0);
        }
    }
}

struct RestoreDisplay;

impl Drop for RestoreDisplay {
    fn drop(&mut self) {
        if let Err(error) = screen_power::set(screen_power::Action::On) {
            eprintln!("display restoration during cleanup failed: {error}");
        }
    }
}

fn wait_for(state: u32) {
    let deadline = Instant::now() + TRANSITION_TIMEOUT;
    while DISPLAY_STATE.load(Ordering::SeqCst) != state {
        assert!(
            Instant::now() < deadline,
            "display never reached state {state}"
        );
        thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "reads the display status of the interactive Windows session"]
fn reads_current_monitor_state_without_a_power_command() {
    let _observer = PowerObserver::new();
    let state = screen_power::state().expect("current Windows display state");
    match DISPLAY_STATE.load(Ordering::SeqCst) {
        0 => assert_eq!(state, screen_power::DisplayState::Off),
        1 | 2 => assert_eq!(state, screen_power::DisplayState::On),
        value => panic!("unknown Windows display state: {value}"),
    }
}

#[test]
#[ignore = "switches physical monitors off/on; requires an interactive Windows session without user input"]
fn restored_monitor_stays_on() {
    let _observer = PowerObserver::new();
    wait_for(DISPLAY_ON);
    let _restore_on_failure = RestoreDisplay;
    for cycle in 1..=2 {
        screen_power::set(screen_power::Action::Off).unwrap();
        wait_for(DISPLAY_OFF);
        thread::sleep(Duration::from_secs(2));
        assert_eq!(DISPLAY_STATE.load(Ordering::SeqCst), DISPLAY_OFF);
        let off_events = OFF_EVENTS.load(Ordering::SeqCst);
        screen_power::set(screen_power::Action::On).unwrap();
        wait_for(DISPLAY_ON);
        thread::sleep(RESTORE_OBSERVATION);
        assert_eq!(
            OFF_EVENTS.load(Ordering::SeqCst),
            off_events,
            "display powered off again"
        );
        assert_eq!(DISPLAY_STATE.load(Ordering::SeqCst), DISPLAY_ON);
        println!("cycle {cycle}: display restored and stayed on for {RESTORE_OBSERVATION:?}");
    }
}

#[test]
#[ignore = "changes monitor power; run only on the explicitly selected test device"]
fn manual_off_survives_windows_wake_requests() {
    let _observer = PowerObserver::new();
    let _restore_on_failure = RestoreDisplay;
    screen_power::set(screen_power::Action::Off).unwrap();
    wait_for(DISPLAY_OFF);
    assert!(screen_power::is_off());
    for _ in 0..3 {
        let before = OFF_EVENTS.load(Ordering::SeqCst);
        // SAFETY: the opt-in test simulates an external Windows wake request with a documented flag.
        assert_ne!(unsafe { SetThreadExecutionState(ES_DISPLAY_REQUIRED) }.0, 0);
        let deadline = Instant::now() + TRANSITION_TIMEOUT;
        while OFF_EVENTS.load(Ordering::SeqCst) == before {
            assert!(
                Instant::now() < deadline,
                "manual off was lost after a wake request"
            );
            thread::sleep(Duration::from_millis(50));
        }
        wait_for(DISPLAY_OFF);
    }
    screen_power::set(screen_power::Action::On).unwrap();
    assert!(!screen_power::is_off());
    wait_for(DISPLAY_ON);
    thread::sleep(Duration::from_secs(3));
    assert_eq!(DISPLAY_STATE.load(Ordering::SeqCst), DISPLAY_ON);
}

#[test]
#[ignore = "live remote desktop test; requires CSW_SCREEN_POWER_TEST_DIR on the selected test device"]
fn manual_off_during_remote_connection() {
    let directory =
        std::path::PathBuf::from(std::env::var_os("CSW_SCREEN_POWER_TEST_DIR").unwrap());
    assert!(directory.is_dir());
    let _observer = PowerObserver::new();
    let _restore_on_failure = RestoreDisplay;
    screen_power::set(screen_power::Action::Off).unwrap();
    wait_for(DISPLAY_OFF);
    let awake_events = AWAKE_EVENTS.load(Ordering::SeqCst);
    std::fs::write(directory.join("ready"), b"off").unwrap();
    let deadline = Instant::now() + Duration::from_secs(240);
    while !directory.join("finish").is_file() {
        assert!(
            Instant::now() < deadline,
            "remote viewer did not finish within four minutes"
        );
        thread::sleep(Duration::from_millis(100));
    }
    wait_for(DISPLAY_OFF);
    assert_eq!(
        AWAKE_EVENTS.load(Ordering::SeqCst),
        awake_events,
        "remote connection briefly woke the display"
    );
    assert!(
        screen_power::is_off(),
        "capture cleanup discarded the device's power choice"
    );
    println!("remote connection finished with explicit display-off ownership intact");
}
