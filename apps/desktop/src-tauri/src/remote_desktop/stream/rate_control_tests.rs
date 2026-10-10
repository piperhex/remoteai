use super::*;
use std::cell::Cell;

thread_local! {
    static LAST_REPORT: Cell<Instant> = Cell::new(Instant::now());
}

fn report<T>(value: T) -> NetworkReport<T> {
    // Consecutive simulated reports must remain distinct even within one Windows clock tick.
    let received_at = LAST_REPORT.with(|last| {
        let next = Instant::now().max(last.get() + Duration::from_nanos(1));
        last.set(next);
        next
    });
    NetworkReport { value, received_at }
}

fn profile() -> Profile {
    Profile {
        codec: Default::default(),
        adaptive_fps: true,
        adaptive_resolution: true,
        width: 2560,
        fps: 60,
        bitrate: 12_000_000,
    }
}

fn feedback(loss: f64) -> Feedback {
    Feedback {
        loss: Some(report(loss)),
        ..Default::default()
    }
}

fn congest(rate: &mut RateController) -> Profile {
    // Each downgrade requires sustained, independently received congestion evidence.
    for _ in 1..CONGESTED_SAMPLES {
        assert!(rate.sample(feedback(0.1), rate.current.bitrate).is_none());
    }
    rate.sample(feedback(0.1), rate.current.bitrate).unwrap()
}

fn recover(rate: &mut RateController) -> Profile {
    assert!(rate.sample(feedback(0.0), 1_000_000).is_none());
    assert!(rate.sample(feedback(0.0), 1_000_000).is_none());
    rate.sample(feedback(0.0), 1_000_000).unwrap()
}

#[test]
fn lowers_frames_in_small_steps_before_resolution_and_preserves_frame_quality() {
    let mut rate = RateController::new(profile());
    for fps in [50, 40, 30] {
        let next = congest(&mut rate);
        assert_eq!(
            (next.width, next.fps, next.bitrate),
            (2560, fps, fps * 200_000)
        );
    }
    let next = congest(&mut rate);
    assert_eq!((next.width, next.fps, next.bitrate), (1920, 30, 3_375_000));
    assert_eq!(congest(&mut rate).width, 1280);
    assert_eq!(congest(&mut rate).width, 854);
    assert_eq!(congest(&mut rate).fps, 20);
    assert_eq!(congest(&mut rate).fps, 15);
}

#[test]
fn manual_frame_rate_is_a_ceiling_and_manual_quality_keeps_its_resolution() {
    let requested = Profile {
        adaptive_fps: false,
        adaptive_resolution: false,
        fps: 45,
        ..profile()
    };
    let mut rate = RateController::new(requested);
    assert_eq!(congest(&mut rate).fps, 35);
    assert_eq!(congest(&mut rate).fps, 30);
    let next = congest(&mut rate);
    assert_eq!((next.width, next.fps), (2560, 30));
    assert!(next.bitrate < rate.bitrate_for(next));
    for _ in 0..40 {
        rate.sample(feedback(0.0), 1_000_000);
    }
    assert_eq!(rate.current, requested);
}

#[test]
fn does_not_raise_manual_limits_at_or_below_thirty() {
    for fps in [1, 24, 30] {
        let requested = Profile {
            adaptive_fps: false,
            fps,
            ..profile()
        };
        let mut rate = RateController::new(requested);
        assert_eq!(congest(&mut rate).fps, fps);
        assert_eq!(rate.current.width, 1920);
        for _ in 0..50 {
            rate.sample(feedback(0.0), 500_000);
        }
        assert_eq!(rate.current, requested);
    }
}

#[test]
fn restores_resolution_before_high_frame_rates_after_three_healthy_reports() {
    let mut rate = RateController::new(profile());
    for _ in 0..5 {
        congest(&mut rate);
    }
    assert_eq!((rate.current.width, rate.current.fps), (1280, 30));
    assert_eq!((recover(&mut rate).width, rate.current.fps), (1920, 30));
    assert_eq!((recover(&mut rate).width, rate.current.fps), (2560, 30));
    for fps in [40, 50, 60] {
        assert_eq!(recover(&mut rate).fps, fps);
    }
    assert_eq!(rate.current, profile());
}

#[test]
fn quiet_screens_do_not_trigger_downgrades() {
    let mut rate = RateController::new(profile());
    for _ in 0..20 {
        let feedback = Feedback {
            capacity: Some(report(100_000)),
            ..feedback(0.0)
        };
        assert!(rate.sample(feedback, 80_000).is_none());
    }
}

#[test]
fn reusing_one_report_or_requesting_keyframes_cannot_repeat_a_downgrade() {
    let mut rate = RateController::new(profile());
    for _ in 1..CONGESTED_SAMPLES {
        assert!(rate.sample(feedback(0.1), 12_000_000).is_none());
    }
    let mut report = feedback(0.1);
    assert_eq!(rate.sample(report, 12_000_000).unwrap().fps, 50);
    for _ in 0..20 {
        report.keyframes += 1;
        assert!(rate.sample(report, 12_000_000).is_none());
    }
    assert_eq!(congest(&mut rate).fps, 40);
}

#[test]
fn expired_feedback_and_missing_reports_cannot_change_quality() {
    let mut rate = RateController::new(profile());
    let stale = Instant::now() - MAX_FEEDBACK_AGE - Duration::from_secs(1);
    let feedback = Feedback {
        loss: Some(NetworkReport {
            value: 0.2,
            received_at: stale,
        }),
        capacity: Some(NetworkReport {
            value: 100_000,
            received_at: stale,
        }),
        ..Default::default()
    };
    assert!(rate.sample(feedback, 12_000_000).is_none());
    congest(&mut rate);
    for _ in 0..20 {
        assert!(rate.sample(Feedback::default(), 0).is_none());
    }
    assert_eq!(rate.current.fps, 50);
}

#[test]
fn fresh_capacity_does_not_refresh_an_old_loss_report() {
    let mut rate = RateController::new(profile());
    congest(&mut rate);
    let mut feedback = feedback(0.1);
    rate.sample(feedback, 12_000_000);
    for _ in 0..10 {
        feedback.capacity = Some(report(12_000_000));
        assert!(rate.sample(feedback, 10_000_000).is_none());
    }
    assert_eq!(rate.current.fps, 50);
}

#[test]
fn repeated_healthy_report_cannot_accelerate_recovery() {
    let mut rate = RateController::new(profile());
    congest(&mut rate);
    let feedback = feedback(0.0);
    for _ in 0..20 {
        assert!(rate.sample(feedback, 1_000_000).is_none());
    }
    assert_eq!(rate.current.fps, 50);
}

#[test]
fn recovery_handles_nonstandard_display_widths_and_extreme_frame_caps() {
    for fps in [31, 90, 144] {
        let requested = Profile {
            fps,
            width: 2256,
            bitrate: 32_000_000,
            ..profile()
        };
        let mut rate = RateController::new(requested);
        for _ in 0..120 {
            rate.cooldown = 0;
            rate.sample(feedback(0.1), rate.current.bitrate);
        }
        for _ in 0..200 {
            rate.sample(feedback(0.0), 100_000);
        }
        assert_eq!(rate.current, requested);
    }
}

#[test]
fn old_profiles_keep_fixed_resolution_when_the_new_flag_is_missing() {
    let profile: Profile = serde_json::from_value(serde_json::json!({
        "width": 2560, "fps": 60, "bitrate": 12_000_000, "adaptiveFps": true
    }))
    .unwrap();
    assert!(!profile.adaptive_resolution);
}

#[test]
fn quiet_hd_does_not_collapse_bitrate_or_resolution_on_low_capacity_estimates() {
    for automatic in [false, true] {
        let requested = Profile {
            adaptive_fps: automatic,
            adaptive_resolution: automatic,
            ..profile()
        };
        let mut rate = RateController::new(requested);
        for _ in 0..60 {
            let report = Feedback {
                capacity: Some(report(300_000)),
                ..feedback(0.0)
            };
            assert!(rate.sample(report, 600_000).is_none());
        }
        assert_eq!(rate.current, requested);
    }
}

#[test]
fn capacity_reports_do_not_erase_sustained_packet_loss() {
    let mut rate = RateController::new(profile());
    for _ in 0..2 {
        assert!(rate.sample(feedback(0.1), 12_000_000).is_none());
        let capacity = Feedback {
            capacity: Some(report(20_000_000)),
            ..Default::default()
        };
        assert!(rate.sample(capacity, 12_000_000).is_none());
    }
    assert_eq!(rate.sample(feedback(0.1), 12_000_000).unwrap().fps, 50);
}

#[test]
fn loss_reports_do_not_erase_sustained_capacity_pressure() {
    let mut rate = RateController::new(profile());
    for index in 0..3 {
        let capacity = Feedback {
            capacity: Some(report(1_000_000)),
            ..Default::default()
        };
        let next = rate.sample(capacity, 12_000_000);
        if index < 2 {
            assert!(next.is_none());
            assert!(rate.sample(feedback(0.0), 12_000_000).is_none());
        } else {
            assert_eq!(next.unwrap().fps, 50);
        }
    }
}

#[test]
fn capacity_only_reports_do_not_erase_independent_healthy_loss_reports() {
    let mut rate = RateController::new(profile());
    congest(&mut rate);
    for _ in 0..2 {
        assert!(rate.sample(feedback(0.0), 1_000_000).is_none());
        let report = Feedback {
            capacity: Some(report(12_000_000)),
            ..Default::default()
        };
        assert!(rate.sample(report, 1_000_000).is_none());
    }
    assert_eq!(rate.sample(feedback(0.0), 1_000_000).unwrap(), profile());
}

#[test]
fn one_transient_report_cannot_change_the_encoder() {
    let mut rate = RateController::new(profile());
    assert!(rate.sample(feedback(0.1), 12_000_000).is_none());
    for _ in 0..10 {
        assert!(rate.sample(feedback(0.0), 12_000_000).is_none());
    }
    assert_eq!(rate.current, profile());
}

#[test]
fn busy_sender_does_not_probe_above_known_capacity_and_oscillate() {
    let mut rate = RateController::new(profile());
    for _ in 0..3 {
        congest(&mut rate);
    }
    let stable = rate.current;
    assert_eq!(stable.bitrate, 6_000_000);
    for _ in 0..30 {
        let report = Feedback {
            capacity: Some(report(6_500_000)),
            ..feedback(0.0)
        };
        assert!(rate.sample(report, 6_000_000).is_none());
    }
    assert_eq!(rate.current, stable);
}

#[test]
fn expired_capacity_pressure_cannot_block_healthy_recovery() {
    let mut rate = RateController::new(profile());
    congest(&mut rate);
    let pressure = Feedback {
        capacity: Some(report(1_000_000)),
        ..Default::default()
    };
    assert!(rate.sample(pressure, 10_000_000).is_none());
    rate.last_capacity = Some(Instant::now() - MAX_FEEDBACK_AGE - Duration::from_secs(1));
    assert_eq!(recover(&mut rate), profile());
}
