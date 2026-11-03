//! Recover IPC without replaying unacknowledged application requests.
use super::{Instant, Runtime};

impl Runtime {
    pub(super) fn recover_stalled_ipc(&mut self, now: Instant) -> bool {
        if !self
            .bridge
            .as_ref()
            .is_some_and(|bridge| bridge.stalled(now))
            && !self.bulk.stalled(now)
        {
            return false;
        }
        self.fail_host_transport();
        true
    }

    pub(super) fn fail_host_transport(&mut self) {
        // Replaying an uncertain batch can execute a request twice. A fresh host must pair again.
        eprintln!("remote chat: IPC delivery stalled or failed; waiting for a fresh host");
        self.reset();
        self.bridge = None;
        // Retain the receiver until its worker exits. A replacement host must not overlap
        // a still-running DNS/TLS attempt; its obsolete generation will be discarded.
        self.health.transport_failed();
    }
}

#[cfg(test)]
#[path = "host_recovery_tests.rs"]
mod tests;
