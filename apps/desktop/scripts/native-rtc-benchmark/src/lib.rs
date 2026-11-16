//! Compile the actual desktop transport in isolation so diagnostic changes do not relink the whole GUI.
#[cfg(test)]
mod native_rtc;
