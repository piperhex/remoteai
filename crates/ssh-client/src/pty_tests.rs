//! Encrypted SSH loopback tests verify PTY acknowledgement and exact interactive input delivery.
use crate::{Client, Command, Connect, Endpoint, Error, Event, Info, Size};
use russh::{
    keys::{ssh_key::private::Ed25519Keypair, HashAlg, PrivateKey},
    server, Channel, ChannelId, Pty,
};
use std::{sync::Arc, time::Duration};
use tokio::{
    net::TcpListener,
    sync::{mpsc, Mutex},
};

#[derive(Default)]
struct Observed {
    starts: Vec<Vec<u8>>,
    input: Vec<u8>,
    sizes: Vec<(u32, u32)>,
}
struct Server {
    observed: Arc<Mutex<Observed>>,
    channels: Vec<Channel<server::Msg>>,
    reject_pty: bool,
}

impl server::Handler for Server {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        _: &str,
        password: &str,
    ) -> Result<server::Auth, Self::Error> {
        assert_eq!(password, "fixture-password");
        Ok(server::Auth::Accept)
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.channels.push(channel);
        reply.accept().await;
        Ok(())
    }
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &[(Pty, u32)],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        assert_eq!(term, "xterm-256color");
        self.observed.lock().await.sizes.push((cols, rows));
        if self.reject_pty {
            session.channel_failure(channel)
        } else {
            session.channel_success(channel)
        }
    }
    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.observed.lock().await.starts.push(b"shell".to_vec());
        session.channel_success(channel)?;
        session.data(channel, b"shell ready\r\n".to_vec())
    }
    async fn exec_request(
        &mut self,
        channel: ChannelId,
        command: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.observed.lock().await.starts.push(command.to_vec());
        session.channel_success(channel)?;
        session.data(channel, b"Password: ".to_vec())
    }
    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.observed.lock().await.input.extend_from_slice(data);
        if data == [3] {
            session.exit_status_request(channel, 130)?;
            session.eof(channel)?;
            return session.close(channel);
        }
        session.data(channel, data.to_vec())
    }
    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        self.observed.lock().await.sizes.push((cols, rows));
        session.data(channel, b"resized".to_vec())
    }
    async fn channel_close(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.close(channel)
    }
}

struct Fixture {
    client: Arc<Client>,
    info: crate::Result<Info>,
    output: mpsc::UnboundedReceiver<Event>,
    observed: Arc<Mutex<Observed>>,
}

async fn fixture(command: Option<&str>, reject_pty: bool) -> Fixture {
    let key = PrivateKey::from(Ed25519Keypair::from_seed(&[61; 32]));
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        ..Default::default()
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let observed = Arc::new(Mutex::new(Observed::default()));
    let handler = Server {
        observed: observed.clone(),
        channels: Vec::new(),
        reject_pty,
    };
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        if let Ok(session) = server::run_stream(config, socket, handler).await {
            // Explicit client close and a rejected PTY both intentionally end this fixture transport.
            let _result = session.await;
        }
    });
    let client = Arc::new(Client::default());
    let (send, output) = mpsc::unbounded_channel();
    let info = client
        .open_pty(
            Connect {
                endpoint: Endpoint {
                    host: "127.0.0.1".into(),
                    port,
                },
                username: "fixture".into(),
                fingerprint,
                password: Some("fixture-password".into()),
                private_key: None,
                passphrase: None,
                size: Size {
                    cols: 100,
                    rows: 30,
                },
                x11: None,
            },
            command.map(str::to_owned),
            Arc::new(move |event| send.send(event).is_ok()),
        )
        .await;
    Fixture {
        client,
        info,
        output,
        observed,
    }
}

async fn event(output: &mut mpsc::UnboundedReceiver<Event>) -> Event {
    tokio::time::timeout(Duration::from_secs(3), output.recv())
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn interactive_command_receives_pty_input_resize_and_interrupt_without_replay() {
    let mut fixture = fixture(Some("sudo fixture-script"), false).await;
    let id = fixture.info.as_ref().unwrap().id.clone();
    assert!(
        matches!(event(&mut fixture.output).await, Event::Output { data } if data == b"Password: ")
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(20), fixture.output.recv())
            .await
            .is_err()
    );
    fixture
        .client
        .command(Command::WriteBinary {
            id: id.clone(),
            data: b"saved-password\r".to_vec(),
        })
        .await
        .unwrap();
    assert!(
        matches!(event(&mut fixture.output).await, Event::Output { data } if data == b"saved-password\r")
    );
    fixture
        .client
        .command(Command::Resize {
            id: id.clone(),
            size: Size {
                cols: 140,
                rows: 40,
            },
        })
        .await
        .unwrap();
    assert!(
        matches!(event(&mut fixture.output).await, Event::Output { data } if data == b"resized")
    );
    fixture
        .client
        .command(Command::WriteBinary { id, data: vec![3] })
        .await
        .unwrap();
    assert!(matches!(
        event(&mut fixture.output).await,
        Event::Exit { code: Some(130) }
    ));
    let observed = fixture.observed.lock().await;
    assert_eq!(observed.starts, [b"sudo fixture-script".to_vec()]);
    assert_eq!(observed.input, b"saved-password\r\x03");
    assert_eq!(observed.sizes, [(100, 30), (140, 40)]);
}

#[tokio::test]
async fn persistent_shell_closes_explicitly_and_pty_rejection_never_starts_a_script() {
    let mut shell = fixture(None, false).await;
    let id = shell.info.as_ref().unwrap().id.clone();
    assert!(
        matches!(event(&mut shell.output).await, Event::Output { data } if data == b"shell ready\r\n")
    );
    shell.client.command(Command::Close { id }).await.unwrap();
    assert!(matches!(event(&mut shell.output).await, Event::Exit { .. }));
    assert_eq!(shell.observed.lock().await.starts, [b"shell".to_vec()]);
    let rejected = fixture(Some("must not start"), true).await;
    assert!(matches!(rejected.info, Err(Error::Connection)));
    assert!(rejected.observed.lock().await.starts.is_empty());
}
