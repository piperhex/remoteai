//! Physical monitor power commands do not open, capture, or lock the desktop.
use serde::{Deserialize, Serialize};

#[cfg(windows)]
#[path = "screen_power/windows.rs"]
mod windows;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Off,
    On,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DisplayState {
    #[cfg(windows)]
    Off,
    #[cfg(windows)]
    On,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("monitor power command unavailable")]
    Unavailable,
}

/// Called from the device control worker, never from the UI message thread.
pub(crate) fn set(action: Action) -> Result<(), Error> {
    #[cfg(windows)]
    return windows::set(action);
    #[cfg(not(windows))]
    {
        let _ = action;
        Err(Error::Unavailable)
    }
}

pub(crate) fn state() -> Result<DisplayState, Error> {
    #[cfg(windows)]
    return windows::state();
    #[cfg(not(windows))]
    Err(Error::Unavailable)
}

/// Read-only across the interactive host, privileged capture worker and privacy guardian.
#[cfg(windows)]
pub(crate) fn is_off() -> bool {
    windows::is_off()
}

#[cfg(test)]
mod tests {
    use super::Action;

    #[test]
    fn accepts_only_explicit_monitor_power_actions() {
        assert_eq!(
            serde_json::from_str::<Action>(r#""off""#).unwrap(),
            Action::Off
        );
        assert_eq!(
            serde_json::from_str::<Action>(r#""on""#).unwrap(),
            Action::On
        );
        for input in [r#""toggle""#, r#""sleep""#, "false", "null", "2"] {
            assert!(serde_json::from_str::<Action>(input).is_err());
        }
    }
}
