//! Session-scoped, userspace connectivity shared by the desktop and mobile clients.
//! EasyTier owns traversal and transport; this crate restricts its lifetime and application access.

mod addresses;
#[cfg(target_os = "android")]
mod android;
mod bulk;
mod config;
mod connection;
mod diagnostics;
mod error;
mod ffi;
mod lease;
mod media;
mod route;
#[cfg(test)]
mod tests;

pub use addresses::local_addresses;
pub use config::Config;
pub use connection::{Connection, Event};
pub use error::{Error, Result};
pub use media::{MediaEndpoint, MediaProxy};
pub use route::RouteStatus;
/// JSON ABI for trusted native workers (mobile modules and the installed service child).
/// This blocking function must never run on a UI thread or a Tokio runtime worker.
pub fn bridge_call(request: &str) -> String {
    ffi::call(request)
}
/// Synchronously cancels bridge-owned sessions without creating or waiting on a runtime.
pub fn close_native_bridges() -> Result<()> {
    ffi::reset()
}
