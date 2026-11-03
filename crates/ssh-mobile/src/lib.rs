//! Direct mobile SSH. Platform workers call the bounded JSON bridge off the UI thread.
mod buffer;
mod ffi;
mod service;

#[cfg(target_os = "android")]
mod android;

pub use ffi::bridge_call;

#[cfg(test)]
mod tests;
