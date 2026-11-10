//! Bounded SSH sessions and SFTP operations shared by local and authenticated remote terminals.
mod connection;
mod execute;
mod file_mutations;
mod files;
mod sessions;
mod shell_integration;
mod types;
mod upload_destination;
mod uploads;
mod x11;

pub use connection::probe;
pub use execute::{Execution, ExecutionError, ExecutionOptions};
pub use sessions::Client;
pub use types::*;
pub use x11::ensure_x11;

#[cfg(test)]
mod pty_tests;
#[cfg(test)]
mod tests;
