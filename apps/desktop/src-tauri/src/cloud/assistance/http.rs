use super::{api_client, endpoint, AppSettings, AssistanceError, Client, Mutex};
use reqwest::Url;

#[derive(Default)]
struct ClientPool(Mutex<Option<(Option<Url>, Client)>>);

impl ClientPool {
    fn get(&self, proxy: Option<Url>) -> Result<Client, AssistanceError> {
        let mut cached = self.0.lock().map_err(|_| AssistanceError::Unavailable)?;
        if let Some((route, client)) = cached.as_ref() {
            if route == &proxy {
                return Ok(client.clone());
            }
        }
        let client = api_client().map_err(|_| AssistanceError::Unavailable)?;
        *cached = Some((proxy, client.clone()));
        Ok(client)
    }
}

pub(super) fn client(settings: &AppSettings, path: &str) -> Result<Client, AssistanceError> {
    static POOL: ClientPool = ClientPool(Mutex::new(None));
    let endpoint = endpoint(settings, path).map_err(|_| AssistanceError::Unavailable)?;
    let target = Url::parse(&endpoint).map_err(|_| AssistanceError::Unavailable)?;
    // A live pooled connection must not outlast a change in the effective proxy for this URL.
    POOL.get(crate::system_proxy::proxy_for_target(&target))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::Duration};

    #[test]
    fn consecutive_queries_reuse_a_connection_until_the_proxy_changes() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/remote-assistance", server.server_addr());
        let listener = thread::spawn(move || {
            let mut ports = Vec::new();
            for _ in 0..3 {
                let request = server
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                ports.push(request.remote_addr().unwrap().port());
                request
                    .respond(tiny_http::Response::from_string("ok"))
                    .unwrap();
            }
            ports
        });
        let pool = ClientPool::default();
        let new_proxy = Url::parse("http://127.0.0.1:3128").unwrap();
        for route in [None, None, Some(new_proxy)] {
            let response = pool.get(route).unwrap().get(&endpoint).send().unwrap();
            assert_eq!(response.text().unwrap(), "ok");
        }
        let ports = listener.join().unwrap();
        assert_eq!(ports[0], ports[1]);
        assert_ne!(ports[1], ports[2]);
    }
}
