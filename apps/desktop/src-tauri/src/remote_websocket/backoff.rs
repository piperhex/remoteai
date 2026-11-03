//! Bounded equal jitter for coordinator sockets; successful application authentication resets it.
use std::time::Duration;

const MAXIMUM_MS: u64 = 30_000;

pub(crate) struct ReconnectBackoff {
    initial_ms: u64,
    ceiling_ms: u64,
    random: fn() -> f64,
}

impl ReconnectBackoff {
    pub(crate) fn new(initial_ms: u64) -> Self {
        Self::with_random(initial_ms, rand::random)
    }

    pub(crate) fn with_random(initial_ms: u64, random: fn() -> f64) -> Self {
        let initial_ms = initial_ms.clamp(1, MAXIMUM_MS);
        Self {
            initial_ms,
            ceiling_ms: initial_ms,
            random,
        }
    }

    pub(crate) fn next(&mut self) -> Duration {
        let ceiling = self.ceiling_ms;
        self.ceiling_ms = (ceiling * 2).min(MAXIMUM_MS);
        let sample = (self.random)();
        let fraction = if sample.is_finite() {
            sample.clamp(0.0, 1.0)
        } else {
            0.5
        };
        Duration::from_millis((ceiling as f64 * (0.5 + fraction / 2.0)).ceil() as u64)
    }

    pub(crate) fn reset(&mut self) {
        self.ceiling_ms = self.initial_ms;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grows_saturates_and_resets_without_overflow() {
        let mut retry = ReconnectBackoff::with_random(1500, || 1.0);
        for expected in [1500, 3000, 6000, 12000, 24000, 30000] {
            assert_eq!(retry.next(), Duration::from_millis(expected));
        }
        for _ in 0..10000 {
            assert_eq!(retry.next(), Duration::from_secs(30));
        }
        retry.reset();
        assert_eq!(retry.next(), Duration::from_millis(1500));
    }

    #[test]
    fn independent_clients_spread_retries_in_the_upper_half_of_each_window() {
        let mut early = ReconnectBackoff::with_random(1500, || 0.0);
        let mut middle = ReconnectBackoff::with_random(1500, || 0.5);
        let mut late = ReconnectBackoff::with_random(1500, || 1.0);
        for ceiling in [1500, 3000, 6000, 12000, 24000, 30000, 30000] {
            assert_eq!(early.next().as_millis(), ceiling / 2);
            assert_eq!(middle.next().as_millis(), ceiling * 3 / 4);
            assert_eq!(late.next().as_millis(), ceiling);
        }
    }
}
