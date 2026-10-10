use super::super::{DesktopError, Result};
use super::{
    model::*,
    peer::{self, Peer},
    pump,
};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch, Mutex};

pub(super) struct Stream {
    pub id: String,
    #[cfg(windows)]
    pub runtime: PathBuf,
    pub display: watch::Sender<super::super::monitors::Monitor>,
    pub privacy: mpsc::Sender<super::privacy::Change>,
    pub privacy_pending: Mutex<Option<super::privacy::Pending>>,
    pub peer: watch::Sender<Arc<Peer>>,
    pub initial_peer: std::sync::Weak<Peer>,
    pub upgrades: Mutex<super::direct::Upgrades>,
    pub relay_standby: bool,
    pub standby: Mutex<super::relay::Standby>,
    pub ice_servers: Vec<IceServer>,
    pub separate_clipboard: bool,
    pub inputs: mpsc::Sender<bytes::Bytes>,
    pub clipboard_inputs: mpsc::Sender<bytes::Bytes>,
    pub profile: watch::Sender<Profile>,
    pub connected: watch::Sender<bool>,
    pub cancel: watch::Sender<bool>,
    pub heartbeat: watch::Sender<Instant>,
    pub stats: Mutex<StreamStats>,
    pub last_frame: Mutex<Instant>,
    pub audio: Mutex<AudioState>,
}

impl Stream {
    pub async fn open(path: PathBuf, request: OpenRequest) -> Result<(Arc<Self>, Offer)> {
        let mut profile = request.profile.validate()?;
        if request.ice_servers.len() > 8 {
            return Err(DesktopError::Invalid);
        }
        for server in &request.ice_servers {
            server.validate()?;
        }
        let display = super::capture_recovery::display(&request.id).await?;
        let (mut encoder, _) = open_encoder(&path, &mut profile, &display, &request.id).await?;
        let peer = match peer::create_codec(
            request.ice_servers.clone(),
            request.clipboard_channel,
            profile.codec,
        )
        .await
        {
            Ok(peer) => peer,
            Err(error) => {
                encoder.stop().await;
                return Err(error);
            }
        };
        let (inputs, receiver) = mpsc::channel(64);
        let (privacy, changes) = super::privacy::channel();
        let (clipboard, clipboard_receiver) = mpsc::channel(8);
        let peer = Arc::new(peer);
        let stream = Arc::new(Self {
            id: request.id,
            #[cfg(windows)]
            runtime: path.clone(),
            display: watch::channel(display).0,
            privacy,
            privacy_pending: Mutex::new(None),
            peer: watch::channel(Arc::clone(&peer)).0,
            initial_peer: Arc::downgrade(&peer),
            upgrades: Mutex::new(super::direct::Upgrades::default()),
            relay_standby: request.relay_standby,
            standby: Mutex::new(super::relay::Standby::default()),
            ice_servers: request.ice_servers,
            separate_clipboard: request.clipboard_channel,
            inputs,
            clipboard_inputs: clipboard,
            profile: watch::channel(profile).0,
            connected: watch::channel(false).0,
            cancel: watch::channel(false).0,
            heartbeat: watch::channel(Instant::now()).0,
            stats: Mutex::new(StreamStats::default()),
            last_frame: Mutex::new(Instant::now()),
            audio: Mutex::new(AudioState::Starting),
        });
        peer::bind(&stream, &peer);
        let offer = peer.offer().await;
        if offer.is_err() {
            encoder.stop().await;
            stream.close().await;
        }
        let mut offer = offer?;
        offer.relay_standby = stream.relay_standby;
        tokio::spawn(super::audio::run(Arc::clone(&stream), path.clone()));
        tokio::spawn(pump::run(Arc::clone(&stream), path, encoder, changes));
        tokio::spawn(pump::inputs(Arc::clone(&stream), receiver, false));
        tokio::spawn(pump::inputs(Arc::clone(&stream), clipboard_receiver, true));
        Ok((stream, offer))
    }

    pub async fn signal(self: &Arc<Self>, request: SignalRequest) -> Result<SignalReply> {
        if *self.cancel.borrow() {
            return Err(DesktopError::Expired);
        }
        if let Some(standby) = request.relay_standby {
            if !self.relay_standby || request.direct_upgrade.is_some() {
                return Err(DesktopError::Invalid);
            }
            return super::relay::signal(self, standby, request).await;
        }
        if let Some(upgrade) = request.direct_upgrade {
            return super::direct::signal(self, upgrade, request).await;
        }
        let peer = self.initial_peer.upgrade().ok_or(DesktopError::Expired)?;
        peer.signal(request).await
    }

    pub async fn close(&self) {
        self.cancel.send_replace(true);
        self.stats.lock().await.closed = true;
        let peer = Arc::clone(&self.peer.borrow());
        peer.close().await;
        super::direct::close(self).await;
        super::relay::close(self).await;
    }

    pub async fn keep_alive(&self) -> Result<()> {
        if *self.connected.borrow() && self.heartbeat.borrow().elapsed() > Duration::from_secs(12) {
            return Err(DesktopError::Expired);
        }
        let id = self.id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            super::super::with_lease(&id, |session| {
                if let Some(guardian) = session.privacy.as_mut() {
                    guardian.send("ping")?;
                }
                Ok(())
            })
        })
        .await
        .map_err(|_| DesktopError::Platform)?
    }
}

async fn open_encoder(
    path: &std::path::Path,
    profile: &mut Profile,
    display: &super::super::monitors::Monitor,
    id: &str,
) -> Result<(super::encoder::Encoder, Vec<u8>)> {
    if profile.codec == super::codec::VideoCodec::H265 {
        if let Ok(opened) = super::encoder::Encoder::open(path, *profile, display).await {
            return Ok(opened);
        }
        // Select the compatible codec before creating any SDP or track; live peers keep one codec.
        profile.codec = super::codec::VideoCodec::H264;
    }
    super::capture_recovery::open(path, *profile, display, id).await
}
