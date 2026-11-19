//! Explicit display power ownership outlives capture leases and display topology changes.
use super::{Action, DisplayState, Error};
use ::windows::{
    core::{w, GUID},
    Win32::{
        Foundation::{CloseHandle, HANDLE, LPARAM, WAIT_OBJECT_0, WPARAM},
        System::{
            Power::{
                PowerSettingRegisterNotification, PowerSettingUnregisterNotification,
                SetThreadExecutionState, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, ES_DISPLAY_REQUIRED,
                HPOWERNOTIFY, POWERBROADCAST_SETTING,
            },
            Threading::{
                CreateEventW, OpenEventW, ResetEvent, SetEvent, WaitForSingleObject,
                SYNCHRONIZATION_SYNCHRONIZE,
            },
        },
        UI::WindowsAndMessaging::{
            FindWindowW, GetDesktopWindow, SendMessageTimeoutW, DEVICE_NOTIFY_CALLBACK,
            PBT_POWERSETTINGCHANGE, SC_MONITORPOWER, SMTO_ABORTIFHUNG, SMTO_ERRORONEXIT,
            WM_SYSCOMMAND,
        },
    },
};
use std::{
    ffi::c_void,
    sync::{mpsc, Condvar, Mutex, OnceLock},
    time::Duration,
};

const CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(0x6fe69556_704a_47a0_8f24_c28d936fda47);
const OFF_EVENT: ::windows::core::PCWSTR = w!("Local\\RemoteAI.ScreenPower.Off");
const COMMAND_TIMEOUT_MS: u32 = 2_000;
const MONITOR_OFF: isize = 2;
static CONTROLLER: OnceLock<Result<mpsc::Sender<Message>, Error>> = OnceLock::new();
static DISPLAY_STATE: Mutex<Option<DisplayState>> = Mutex::new(None);
static DISPLAY_CHANGED: Condvar = Condvar::new();
const INITIAL_STATE_TIMEOUT: Duration = Duration::from_millis(750);

enum Message {
    Set(Action, mpsc::SyncSender<Result<(), Error>>),
    DisplayAwake,
}

pub(super) fn set(action: Action) -> Result<(), Error> {
    let sender = controller()?;
    let (reply, response) = mpsc::sync_channel(1);
    sender
        .send(Message::Set(action, reply))
        .map_err(|_| Error::Unavailable)?;
    response.recv().map_err(|_| Error::Unavailable)?
}

fn controller() -> Result<&'static mpsc::Sender<Message>, Error> {
    CONTROLLER
        .get_or_init(start)
        .as_ref()
        .map_err(|_| Error::Unavailable)
}

pub(super) fn state() -> Result<DisplayState, Error> {
    controller()?;
    let state = DISPLAY_STATE.lock().map_err(|_| Error::Unavailable)?;
    let (state, _) = DISPLAY_CHANGED
        .wait_timeout_while(state, INITIAL_STATE_TIMEOUT, |state| state.is_none())
        .map_err(|_| Error::Unavailable)?;
    state.ok_or(Error::Unavailable)
}

pub(super) fn is_off() -> bool {
    // SAFETY: OpenEvent borrows a fixed name and grants observation only. Close the owned handle.
    unsafe {
        let Ok(event) = OpenEventW(SYNCHRONIZATION_SYNCHRONIZE, false, OFF_EVENT) else {
            return false;
        };
        let off = WaitForSingleObject(event, 0) == WAIT_OBJECT_0;
        if CloseHandle(event).is_err() {
            eprintln!("monitor power observation cleanup failed");
        }
        off
    }
}

fn start() -> Result<mpsc::Sender<Message>, Error> {
    let (sender, receiver) = mpsc::channel();
    let (ready, result) = mpsc::sync_channel(1);
    let notifications = sender.clone();
    std::thread::Builder::new()
        .name("monitor-power".into())
        .spawn(move || {
            let controller = Controller::new(notifications);
            if ready
                .send(
                    controller
                        .as_ref()
                        .map(|_| ())
                        .map_err(|_| Error::Unavailable),
                )
                .is_err()
            {
                return;
            }
            let Ok(mut controller) = controller else {
                return;
            };
            for message in receiver {
                controller.receive(message);
            }
        })
        .map_err(|_| Error::Unavailable)?;
    result.recv().map_err(|_| Error::Unavailable)??;
    Ok(sender)
}

struct Controller {
    event: HANDLE,
    registration: HPOWERNOTIFY,
    // Windows borrows this stable allocation until notification unregistration completes.
    notifications: Option<Box<mpsc::Sender<Message>>>,
    off: bool,
}

impl Controller {
    fn new(sender: mpsc::Sender<Message>) -> Result<Self, Error> {
        let notifications = Box::new(sender);
        let context = (&*notifications as *const mpsc::Sender<Message>)
            .cast_mut()
            .cast();
        let mut controller = Self {
            event: HANDLE::default(),
            registration: HPOWERNOTIFY::default(),
            notifications: Some(notifications),
            off: false,
        };
        let parameters = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power_changed),
            Context: context,
        };
        // SAFETY: the event is session-scoped with the user's default DACL (including SYSTEM).
        // The callback context is heap-stable and lives until after unregistration in Drop.
        unsafe {
            controller.event =
                CreateEventW(None, true, false, OFF_EVENT).map_err(|_| Error::Unavailable)?;
            let mut registration = std::ptr::null_mut();
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
            .ok()
            .map_err(|_| Error::Unavailable)?;
            controller.registration = HPOWERNOTIFY(registration as isize);
        }
        Ok(controller)
    }

    fn receive(&mut self, message: Message) {
        match message {
            Message::Set(action, reply) => {
                let result = self.apply(action);
                if reply.send(result).is_err() {
                    eprintln!("monitor power response abandoned");
                }
            }
            Message::DisplayAwake if self.off => {
                if turn_off().is_err() {
                    eprintln!("monitor power retention failed");
                }
            }
            Message::DisplayAwake => {}
        }
    }

    fn apply(&mut self, action: Action) -> Result<(), Error> {
        // Clear ownership before waking, so already queued notifications cannot undo an explicit On.
        let off = action == Action::Off;
        // SAFETY: this worker exclusively owns and closes the valid event handle.
        unsafe {
            if off {
                SetEvent(self.event)
            } else {
                ResetEvent(self.event)
            }
        }
        .map_err(|_| Error::Unavailable)?;
        self.off = off;
        if off {
            turn_off()
        } else {
            restore()
        }
    }
}

impl Drop for Controller {
    fn drop(&mut self) {
        // SAFETY: unregister before freeing the callback context; handles belong to this worker.
        unsafe {
            if self.registration.0 != 0
                && PowerSettingUnregisterNotification(self.registration).is_err()
            {
                eprintln!("monitor power notification cleanup failed");
                // Windows may still invoke the callback. Keep its allocation alive on failure.
                std::mem::forget(self.notifications.take());
            }
            if !self.event.is_invalid() && CloseHandle(self.event).is_err() {
                eprintln!("monitor power event cleanup failed");
            }
        }
    }
}

unsafe extern "system" fn power_changed(
    context: *const c_void,
    kind: u32,
    setting: *const c_void,
) -> u32 {
    if kind != PBT_POWERSETTINGCHANGE || setting.is_null() || context.is_null() {
        return 0;
    }
    // SAFETY: Windows supplies the notification and retains our registered context until unregistration.
    let setting = unsafe { &*setting.cast::<POWERBROADCAST_SETTING>() };
    if setting.PowerSetting != CONSOLE_DISPLAY_STATE || setting.DataLength != 4 {
        return 0;
    }
    // SAFETY: the length-checked trailing DWORD may be unaligned.
    let state = match unsafe { setting.Data.as_ptr().cast::<u32>().read_unaligned() } {
        0 => DisplayState::Off,
        1 | 2 => DisplayState::On,
        _ => return 0,
    };
    if let Ok(mut observed) = DISPLAY_STATE.lock() {
        *observed = Some(state);
        DISPLAY_CHANGED.notify_all();
    }
    if state == DisplayState::Off {
        return 0;
    }
    // SAFETY: the registration retains this heap-stable sender until unregistration succeeds.
    let sender = unsafe { &*context.cast::<mpsc::Sender<Message>>() };
    // Never call display APIs inside a power callback: Windows can reenter notification delivery.
    if sender.send(Message::DisplayAwake).is_err() {
        eprintln!("monitor power observer stopped");
    }
    0
}

fn restore() -> Result<(), Error> {
    // A one-shot request resets the expired display idle timer without overriding the power plan.
    // SAFETY: this call takes a documented flag without pointers or a persistent thread requirement.
    if unsafe { SetThreadExecutionState(ES_DISPLAY_REQUIRED) }.0 == 0 {
        Err(Error::Unavailable)
    } else {
        Ok(())
    }
}

fn turn_off() -> Result<(), Error> {
    // SAFETY: Windows owns the target window; fixed integer message arguments and a bounded wait.
    let result = unsafe {
        let target = FindWindowW(w!("Progman"), None).unwrap_or_else(|_| GetDesktopWindow());
        SendMessageTimeoutW(
            target,
            WM_SYSCOMMAND,
            WPARAM(SC_MONITORPOWER as usize),
            LPARAM(MONITOR_OFF),
            SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT,
            COMMAND_TIMEOUT_MS,
            None,
        )
    };
    if result.0 == 0 {
        Err(Error::Unavailable)
    } else {
        Ok(())
    }
}
