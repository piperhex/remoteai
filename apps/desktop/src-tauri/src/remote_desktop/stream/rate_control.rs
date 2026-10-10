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
const CONGESTED_SAMPLES: u8 = 3;
const CHANGE_COOLDOWN: u8 = 2;
const BUSY_BITRATE_PERCENT: u32 = 70;
const MAX_FEEDBACK_AGE: Duration = Duration::from_secs(6);

/// Preserve pixels and per-frame quality by lowering frame rate first, then automatic resolution.
pub(super) struct RateController {
    requested: Profile,
    current: Profile,
    healthy: u8,
    congested_loss: u8,
    congested_capacity: u8,
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
            congested_loss: 0,
            congested_capacity: 0,
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
        self.track_congestion(loss, capacity, sent_bitrate);
        let congested = self.congested_loss.max(self.congested_capacity);
        if congested > 0 {
            self.healthy = 0;
            if self.cooldown > 0 || congested < CONGESTED_SAMPLES {
                return None;
            }
            self.congested_loss = 0;
            self.congested_capacity = 0;
            return self.lower();
        }
        // REMB and Receiver Reports have independent intervals. A capacity-only update must
        // neither erase a healthy loss sample nor count as another one.
        let loss = loss?;
        self.healthy = if loss < 0.01 {
            self.healthy.saturating_add(1)
        } else {
            0
        };
        if self.healthy < HEALTHY_SAMPLES || self.cooldown > 0 {
            return None;
        }
        self.healthy = 0;
        self.raise(recent(feedback.capacity), sent_bitrate)
    }

    pub fn reset_network(&mut self) {
        self.healthy = 0;
        self.congested_loss = 0;
        self.congested_capacity = 0;
        self.cooldown = 0;
        self.last_loss = None;
        self.last_capacity = None;
    }

    fn track_congestion(&mut self, loss: Option<f64>, capacity: Option<u32>, sent_bitrate: u32) {
        // Independently timed reports must neither erase nor duplicate the other source's evidence.
        if self
            .last_loss
            .is_some_and(|last| last.elapsed() > MAX_FEEDBACK_AGE)
        {
            self.congested_loss = 0;
        }
        if self
            .last_capacity
            .is_some_and(|last| last.elapsed() > MAX_FEEDBACK_AGE)
        {
            self.congested_capacity = 0;
        }
        if let Some(loss) = loss {
            self.congested_loss = if loss > 0.05 {
                self.congested_loss + 1
            } else {
                0
            };
        }
        if let Some(capacity) = capacity {
            // Idle traffic and periodic keyframes do not establish the link's bandwidth limit.
            let shortage =
                self.busy(sent_bitrate) && u64::from(capacity) * 5 < u64::from(sent_bitrate) * 4;
            self.congested_capacity = if shortage {
                self.congested_capacity + 1
            } else {
                0
            };
        }
    }

    fn busy(&self, sent_bitrate: u32) -> bool {
        sent_bitrate >= self.current.bitrate * BUSY_BITRATE_PERCENT / 100
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

    fn raise(&mut self, capacity: Option<u32>, sent_bitrate: u32) -> Option<Profile> {
        let next = self.recovery_profile();
        // Preserve headroom for a busy stream; quiet streams can still recover from estimates
        // that are low precisely because little video data has been sent.
        if self.busy(sent_bitrate) && capacity.is_some_and(|capacity| capacity < next.bitrate) {
            return None;
        }
        self.change(next)
    }

    fn recovery_profile(&self) -> Profile {
        let mut next = self.current;
        let target = self.bitrate_for(next);
        if next.bitrate < target {
            next.bitrate = (next.bitrate * 5 / 4).min(target);
            return next;
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
        next
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

fn recent<T: Copy>(report: Option<NetworkReport<T>>) -> Option<T> {
    report
        .filter(|report| report.received_at.elapsed() <= MAX_FEEDBACK_AGE)
        .map(|report| report.value)
}

#[cfg(test)]
#[path = "rate_control_tests.rs"]
mod tests;
