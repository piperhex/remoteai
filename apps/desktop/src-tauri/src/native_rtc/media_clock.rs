//! Test-only pacing on a dedicated blocking worker; never blocks a runtime or UI thread.
use std::time::{Duration, Instant};

pub(super) struct FrameClock {
    interval: Duration,
    deadline: Instant,
    measured: Instant,
    frames: u32,
}

impl FrameClock {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            deadline: Instant::now(),
            measured: Instant::now(),
            frames: 0,
        }
    }

    pub fn wait(&mut self) {
        self.deadline += self.interval;
        std::thread::sleep(self.deadline.saturating_duration_since(Instant::now()));
        // Discard missed slots instead of flooding the receiver with catch-up frames.
        self.deadline = self.deadline.max(Instant::now() - self.interval);
    }

    pub fn sent(&mut self, mime: &str) {
        self.frames += 1;
        let elapsed = self.measured.elapsed();
        if elapsed < Duration::from_secs(2) {
            return;
        }
        eprintln!(
            "Native fixture sender {mime}: {:.1} FPS",
            f64::from(self.frames) / elapsed.as_secs_f64()
        );
        self.frames = 0;
        self.measured = Instant::now();
    }
}
