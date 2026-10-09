use super::model::Profile;
use std::sync::Arc;
use tokio::sync::watch;
use webrtc::{
    rtcp::{
        packet::Packet,
        payload_feedbacks::receiver_estimated_maximum_bitrate::ReceiverEstimatedMaximumBitrate,
        payload_feedbacks::{
            full_intra_request::FullIntraRequest, picture_loss_indication::PictureLossIndication,
        },
        receiver_report::ReceiverReport,
    },
    rtp_transceiver::rtp_sender::RTCRtpSender,
};

#[derive(Clone, Copy, Default)]
pub(super) struct Feedback {
    pub keyframes: u64,
    loss: f64,
    capacity: Option<u32>,
}

pub(super) fn listen(sender: Arc<RTCRtpSender>) -> watch::Receiver<Feedback> {
    let (output, receiver) = watch::channel(Feedback::default());
    tokio::spawn(async move {
        while let Ok((packets, _)) = sender.read_rtcp().await {
            let mut feedback = *output.borrow();
            for packet in packets {
                update(&mut feedback, packet.as_ref());
            }
            output.send_replace(feedback);
        }
    });
    receiver
}

fn update(feedback: &mut Feedback, packet: &(dyn Packet + Send + Sync)) {
    if packet.as_any().is::<PictureLossIndication>() || packet.as_any().is::<FullIntraRequest>() {
        feedback.keyframes = feedback.keyframes.wrapping_add(1);
    }
    if let Some(report) = packet.as_any().downcast_ref::<ReceiverReport>() {
        feedback.loss = report
            .reports
            .iter()
            .map(|item| f64::from(item.fraction_lost) / 256.0)
            .fold(0.0, f64::max);
    }
    if let Some(report) = packet
        .as_any()
        .downcast_ref::<ReceiverEstimatedMaximumBitrate>()
    {
        if report.bitrate.is_finite() && report.bitrate > 0.0 {
            feedback.capacity = Some(report.bitrate as u32);
        }
    }
}

/// Adapt encoded bitrate while preserving the user's resolution/FPS caps. Quiet screens do not prove congestion.
pub(super) struct RateController {
    requested: Profile,
    current: Profile,
    healthy: u8,
    cooldown: u8,
}

impl RateController {
    pub fn new(profile: Profile) -> Self {
        Self {
            requested: profile,
            current: profile,
            healthy: 0,
            cooldown: 0,
        }
    }

    pub fn sample(&mut self, feedback: Feedback, sent_bitrate: u32) -> Option<Profile> {
        self.cooldown = self.cooldown.saturating_sub(1);
        let congested = feedback.loss > 0.05
            || feedback
                .capacity
                .is_some_and(|capacity| sent_bitrate > 200_000 && capacity < sent_bitrate * 4 / 5);
        if congested {
            self.healthy = 0;
            if self.cooldown > 0 {
                return None;
            }
            let bitrate = (self.current.bitrate * 7 / 10).max(200_000);
            return self.change(bitrate);
        }
        self.healthy = if feedback.loss < 0.01 {
            self.healthy.saturating_add(1)
        } else {
            0
        };
        if self.healthy < 3 || self.cooldown > 0 {
            return None;
        }
        // Probe one step; requiring the next cap's bandwidth would trap a capped sender indefinitely.
        self.healthy = 0;
        self.change((self.current.bitrate * 5 / 4).min(self.requested.bitrate))
    }

    fn change(&mut self, bitrate: u32) -> Option<Profile> {
        if bitrate == self.current.bitrate {
            return None;
        }
        self.current.bitrate = bitrate;
        if self.requested.adaptive_fps {
            self.current.fps = ((u64::from(self.requested.fps) * u64::from(bitrate)
                / u64::from(self.requested.bitrate)) as u32)
                .max(15)
                .min(self.requested.fps);
        }
        self.cooldown = 2;
        Some(self.current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile() -> Profile {
        Profile {
            codec: Default::default(),
            adaptive_fps: false,
            width: 1920,
            fps: 60,
            bitrate: 6_000_000,
        }
    }
    #[test]
    fn quiet_screens_do_not_trigger_downgrades() {
        let mut rate = RateController::new(profile());
        for _ in 0..20 {
            assert!(rate
                .sample(
                    Feedback {
                        keyframes: 0,
                        loss: 0.0,
                        capacity: Some(100_000)
                    },
                    80_000
                )
                .is_none());
        }
    }
    #[test]
    fn automatic_frame_rate_follows_capacity_without_overriding_manual_limits() {
        let mut requested = profile();
        requested.adaptive_fps = true;
        let mut rate = RateController::new(requested);
        let reduced = rate
            .sample(
                Feedback {
                    loss: 0.1,
                    ..Default::default()
                },
                requested.bitrate,
            )
            .unwrap();
        assert!(reduced.fps < requested.fps && reduced.fps >= 15);
    }
    #[test]
    fn reduces_congestion_then_probes_recovery_with_hysteresis() {
        let mut rate = RateController::new(profile());
        let busy = Feedback {
            keyframes: 0,
            loss: 0.1,
            capacity: Some(3_000_000),
        };
        let reduced = rate.sample(busy, 6_000_000).unwrap();
        assert!(reduced.bitrate < profile().bitrate);
        assert_eq!(reduced.fps, 60);
        assert!(rate.sample(busy, 6_000_000).is_none());
        for _ in 0..2 {
            assert!(rate.sample(Feedback::default(), 1_000_000).is_none());
        }
        assert!(rate.sample(Feedback::default(), 1_000_000).unwrap().bitrate > reduced.bitrate);
    }
}
