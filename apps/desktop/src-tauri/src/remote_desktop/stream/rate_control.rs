use super::{
    feedback::{Feedback, NetworkReport},
    model::Profile,
};
use std::time::{Duration, Instant};

const QUALITY_FPS_FLOOR: u32 = 30;
const FPS_STEP: u32 = 10;
const MIN_AUTO_FPS: u32 = 15;
const MIN_BITRATE: u32 = 200_000;
const RESOLUTIONS: [u32; 4] = [854, 1280, 1920, 2560];
const HEALTHY_SAMPLES: u8 = 3;
const CHANGE_COOLDOWN: u8 = 2;
const MAX_FEEDBACK_AGE: Duration = Duration::from_secs(6);

/// Preserve pixels and per-frame quality by lowering frame rate first, then automatic resolution.
pub(super) struct RateController {
    requested: Profile,
    current: Profile,
    healthy: u8,
    cooldown: u8,
    last_loss: Option<Instant>,
    last_capacity: Option<Instant>,
}

impl RateController {
    pub fn new(profile: Profile) -> Self {
        Self {
            requested: profile,
            current: profile,
            healthy: 0,
            cooldown: 0,
            last_loss: None,
            last_capacity: None,
        }
    }

    pub fn sample(&mut self, feedback: Feedback, sent_bitrate: u32) -> Option<Profile> {
        self.cooldown = self.cooldown.saturating_sub(1);
        let loss = fresh(feedback.loss, &mut self.last_loss);
        let capacity = fresh(feedback.capacity, &mut self.last_capacity);
        if loss.is_none() && capacity.is_none() {
            return None;
        }
        // Sparse idle frames do not establish a bandwidth shortage, even if REMB is low.
        let congested = loss.is_some_and(|loss| loss > 0.05)
            || capacity.is_some_and(|capacity| {
                sent_bitrate > MIN_BITRATE && capacity < sent_bitrate * 4 / 5
            });
        if congested {
            self.healthy = 0;
            return (self.cooldown == 0).then(|| self.lower()).flatten();
        }
        self.healthy = if loss.is_some_and(|loss| loss < 0.01) {
            self.healthy.saturating_add(1)
        } else {
            0
        };
        if self.healthy < HEALTHY_SAMPLES || self.cooldown > 0 {
            return None;
        }
        // Probe recovery instead of requiring bandwidth that a capped sender cannot demonstrate.
        self.healthy = 0;
        self.raise()
    }

    fn lower(&mut self) -> Option<Profile> {
        let mut next = self.current;
        if next.fps > QUALITY_FPS_FLOOR {
            next.fps = next.fps.saturating_sub(FPS_STEP).max(QUALITY_FPS_FLOOR);
        } else if self.requested.adaptive_resolution && next.width > RESOLUTIONS[0] {
            next.width = RESOLUTIONS
                .into_iter()
                .rev()
                .find(|width| *width < next.width)
                .unwrap_or(next.width);
        } else if self.requested.adaptive_fps && next.fps > MIN_AUTO_FPS {
            next.fps = next.fps.saturating_sub(FPS_STEP).max(MIN_AUTO_FPS);
        } else {
            next.bitrate = (next.bitrate * 7 / 10).max(MIN_BITRATE);
            return self.change(next);
        }
        next.bitrate = self.bitrate_for(next);
        self.change(next)
    }

    fn raise(&mut self) -> Option<Profile> {
        let mut next = self.current;
        let target = self.bitrate_for(next);
        if next.bitrate < target {
            next.bitrate = (next.bitrate * 5 / 4).min(target);
            return self.change(next);
        }
        let floor = QUALITY_FPS_FLOOR.min(self.requested.fps);
        if next.fps < floor {
            next.fps = (next.fps + FPS_STEP).min(floor);
        } else if next.width < self.requested.width {
            next.width = RESOLUTIONS
                .into_iter()
                .find(|width| *width > next.width)
                .unwrap_or(self.requested.width)
                .min(self.requested.width);
        } else {
            next.fps = (next.fps + FPS_STEP).min(self.requested.fps);
        }
        next.bitrate = self.bitrate_for(next);
        self.change(next)
    }

    fn bitrate_for(&self, profile: Profile) -> u32 {
        let pixels_per_second = u64::from(profile.width).pow(2) * u64::from(profile.fps);
        let requested_pixels =
            u64::from(self.requested.width).pow(2) * u64::from(self.requested.fps);
        (u64::from(self.requested.bitrate) * pixels_per_second / requested_pixels)
            .max(u64::from(MIN_BITRATE)) as u32
    }

    fn change(&mut self, profile: Profile) -> Option<Profile> {
        if profile == self.current {
            return None;
        }
        self.current = profile;
        self.cooldown = CHANGE_COOLDOWN;
        Some(profile)
    }
}

fn fresh<T: Copy>(report: Option<NetworkReport<T>>, previous: &mut Option<Instant>) -> Option<T> {
    let report = report?;
    if *previous == Some(report.received_at) || report.received_at.elapsed() > MAX_FEEDBACK_AGE {
        return None;
    }
    *previous = Some(report.received_at);
    Some(report.value)
}

#[cfg(test)]
#[path = "rate_control_tests.rs"]
mod tests;
