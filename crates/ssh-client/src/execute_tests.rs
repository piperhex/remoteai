//! A real encrypted loopback transport verifies authentication, output, host trust and timeout behavior.
use super::*;
use crate::{Endpoint, Size};
use russh::{
    keys::{ssh_key::private::Ed25519Keypair, HashAlg, PrivateKey},
    server, ChannelId,
};
use std::sync::Arc;
use tokio::{net::TcpListener, sync::Mutex};

struct Server {
    commands: Arc<Mutex<Vec<Vec<u8>>>>,
    channels: Vec<Channel<server::Msg>>,
}

impl server::Handler for Server {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        username: &str,
        password: &str,
    ) -> std::result::Result<server::Auth, Self::Error> {
        Ok(if username == "fixture" && password == "saved-password" {
            server::Auth::Accept
        } else {
            server::Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            }
        })
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut server::Session,
    ) -> std::result::Result<(), Self::Error> {
        self.channels.push(channel);
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        command: &[u8],
        session: &mut server::Session,
    ) -> std::result::Result<(), Self::Error> {
        self.commands.lock().await.push(command.to_vec());
        if command == b"reject" {
            session.channel_failure(channel)?;
            session.close(channel)?;
            return Ok(());
        }
        session.channel_success(channel)?;
        session.data(channel, b"hello \xe4\xb8\xad\xe6\x96\x87".to_vec())?;
        session.extended_data(channel, 1, b"warning".to_vec())?;
        if command != b"wait" {
            session.exit_status_request(channel, 7)?;
            session.eof(channel)?;
            session.close(channel)?;
        }
        Ok(())
    }
}

async fn fixture() -> (Connect, Arc<Mutex<Vec<Vec<u8>>>>) {
    let key = PrivateKey::from(Ed25519Keypair::from_seed(&[47; 32]));
    let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
    let config = Arc::new(server::Config {
        keys: vec![key],
        ..Default::default()
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let commands = Arc::new(Mutex::new(Vec::new()));
    let handler = Server {
        commands: commands.clone(),
        channels: Vec::new(),
    };
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        if let Ok(session) = server::run_stream(config, socket, handler).await {
            // Rejected host keys and explicit client cleanup intentionally end the transport.
            let _result = session.await;
        }
    });
    (
        Connect {
            endpoint: Endpoint {
                host: "127.0.0.1".into(),
                port,
            },
            username: "fixture".into(),
            fingerprint,
            password: Some("saved-password".into()),
            private_key: None,
            passphrase: None,
            size: Size { cols: 80, rows: 24 },
            x11: None,
        },
        commands,
    )
}

#[tokio::test]
async fn executes_exact_command_and_returns_separate_output_and_exit_code() {
    let (request, commands) = fixture().await;
    let command = "printf '%s' 'user input; $(literal)'";
    let result = Client::default()
        .execute(
            request,
            ExecutionOptions {
                command: command.into(),
                timeout_seconds: 5,
            },
        )
        .await
        .unwrap();
    assert_eq!(commands.lock().await.as_slice(), &[command.as_bytes()]);
    assert_eq!(result.stdout, "hello 中文");
    assert_eq!(result.stderr, "warning");
    assert_eq!(result.exit_code, Some(7));
    assert!(!result.timed_out && !result.truncated);
}

#[tokio::test]
async fn timeout_returns_partial_output_and_does_not_repeat_execution() {
    let (request, commands) = fixture().await;
    let result = Client::default()
        .execute(
            request,
            ExecutionOptions {
                command: "wait".into(),
                timeout_seconds: 1,
            },
        )
        .await
        .unwrap();
    assert!(result.timed_out);
    assert_eq!(result.stdout, "hello 中文");
    assert_eq!(commands.lock().await.len(), 1);
    assert_eq!(result.exit_code, None);
}

#[tokio::test]
async fn changed_host_key_never_authenticates_or_runs_the_command() {
    let (mut request, commands) = fixture().await;
    request.fingerprint = "SHA256:changed".into();
    let result = Client::default()
        .execute(
            request,
            ExecutionOptions {
                command: "pwd".into(),
                timeout_seconds: 5,
            },
        )
        .await;
    assert!(matches!(result, Err(Error::HostKey)));
    assert!(commands.lock().await.is_empty());
}

#[tokio::test]
async fn authentication_failure_can_retry_before_any_command_is_sent() {
    let (mut request, commands) = fixture().await;
    request.password = Some("stale-password".into());
    let result = Client::default()
        .execute_attempt(
            request,
            ExecutionOptions {
                command: "pwd".into(),
                timeout_seconds: 5,
            },
        )
        .await;
    let error = result.err().unwrap();
    assert!(matches!(
        error,
        ExecutionError::BeforeCommand(Error::Authentication)
    ));
    assert!(error.retryable());
    assert!(commands.lock().await.is_empty());
}

#[tokio::test]
async fn failure_after_dispatch_is_not_retryable_even_without_output() {
    let (request, commands) = fixture().await;
    let result = Client::default()
        .execute_attempt(
            request,
            ExecutionOptions {
                command: "reject".into(),
                timeout_seconds: 5,
            },
        )
        .await;
    let error = result.err().unwrap();
    assert!(matches!(
        error,
        ExecutionError::AfterCommand(Error::Connection)
    ));
    assert!(!error.retryable());
    assert_eq!(commands.lock().await.len(), 1);
}
