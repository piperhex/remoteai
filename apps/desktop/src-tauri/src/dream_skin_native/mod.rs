include!("types.rs");
include!("recovery_state.rs");
include!("paths_and_images.rs");
include!("themes.rs");
include!("payload.rs");
include!("speed_selector_overlay.rs");
include!("usage_statusline.rs");
include!("context_usage_overlay.rs");
include!("model_refresh.rs");
include!("cdp.rs");
include!("pet_dock.rs");
mod connection;
pub(crate) use connection::inspect_connection;
include!("renderer_bindings.rs");
include!("usage_statusline_bindings.rs");
include!("renderer_sync.rs");
include!("injection_monitor.rs");
include!("runtime_recovery.rs");
include!("windows_runtime.rs");
include!("macos_runtime.rs");
include!("runtime_lifecycle.rs");
use crate::codex_runtime::refresh_after_launch;
include!("runtime_launch.rs");
include!("runtime_entry.rs");
include!("theme_commands.rs");
mod thumbnail;

#[cfg(all(test, target_os = "windows"))]
mod tests_recovery_integration;

#[cfg(test)]
mod tests_renderer_bindings;

#[cfg(test)]
mod tests_renderer_sync;

#[cfg(test)]
mod tests_runtime_entry;

#[cfg(test)]
mod tests_runtime_launch;

#[cfg(test)]
mod tests_injection_monitor;

#[cfg(test)]
mod tests {
    include!("tests_theme_and_models.rs");
    include!("tests_runtime.rs");
    include!("tests_recovery.rs");
}
