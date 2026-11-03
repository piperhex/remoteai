use super::{run_connection, Duration, Instant, Runtime};
use crate::remote_websocket::backoff::ReconnectBackoff;
use std::thread;

// Preserve the existing configuration polling cadence while waiting, so login/logout and
// server/token changes can interrupt a long backoff without adding cloud reads.
const CONFIG_POLL: Duration = Duration::from_secs(3);

pub(crate) fn start<R: Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || {
        let mut update_peers = crate::update_peers::Bridge::new(&app);
        let mut backoff = ReconnectBackoff::new(3000);
        let mut retry_at = Instant::now();
        let mut previous = None;
        loop {
            match crate::cloud::remote_control_config(&app) {
                Ok(Some(config)) => {
                    let identity = (
                        config.websocket_url.clone(),
                        config.access_token.clone(),
                        config.device_id.clone(),
                    );
                    let now = Instant::now();
                    if previous.as_ref() == Some(&identity) && now < retry_at {
                        thread::sleep(CONFIG_POLL.min(retry_at - now));
                        continue;
                    }
                    previous = Some(identity);
                    if let Err(error) =
                        run_connection(&app, config, &mut update_peers, &mut backoff)
                    {
                        eprintln!("remote account control disconnected: {error}");
                    }
                    retry_at = Instant::now() + backoff.next();
                }
                Ok(None) => {
                    previous = None;
                    update_peers.signed_out();
                }
                Err(error) => eprintln!("remote account control is unavailable: {error}"),
            }
            update_peers.disconnected();
            let remaining = retry_at.saturating_duration_since(Instant::now());
            thread::sleep(if remaining.is_zero() {
                CONFIG_POLL
            } else {
                CONFIG_POLL.min(remaining)
            });
        }
    });
}
