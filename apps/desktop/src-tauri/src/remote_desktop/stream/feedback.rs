use std::{sync::Arc, time::Instant};
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

/// Timestamp each network measurement independently; keyframe requests do not refresh network evidence.
#[derive(Clone, Copy)]
pub(super) struct NetworkReport<T> {
    pub value: T,
    pub received_at: Instant,
}

impl<T> NetworkReport<T> {
    fn new(value: T) -> Self {
        Self {
            value,
            received_at: Instant::now(),
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct Feedback {
    pub keyframes: u64,
    pub loss: Option<NetworkReport<f64>>,
    pub capacity: Option<NetworkReport<u32>>,
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
        let loss = report
            .reports
            .iter()
            .map(|item| f64::from(item.fraction_lost) / 256.0)
            .reduce(f64::max);
        if let Some(loss) = loss {
            feedback.loss = Some(NetworkReport::new(loss));
        }
    }
    if let Some(report) = packet
        .as_any()
        .downcast_ref::<ReceiverEstimatedMaximumBitrate>()
    {
        if report.bitrate.is_finite() && report.bitrate > 0.0 {
            feedback.capacity = Some(NetworkReport::new(report.bitrate as u32));
        }
    }
}
