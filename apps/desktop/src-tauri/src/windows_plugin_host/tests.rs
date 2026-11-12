use super::*;
use tokio::io::AsyncWriteExt;

#[test]
fn only_builtin_mcp_modes_are_handed_off() {
    for prefix in PREFIXES {
        assert!(helper_argument(&format!("{prefix}{}", "a".repeat(64))));
        assert!(!helper_argument(&format!(
            "{prefix}{} --other",
            "a".repeat(64)
        )));
        assert!(!helper_argument(&format!("{prefix}{}", "z".repeat(64))));
        assert!(!helper_argument(&format!("{prefix}short")));
    }
    assert!(!helper_argument("--computer-use-administrator=anything"));
    assert!(!helper_argument("--desktop-service"));
    assert!(!helper_argument("chrome-extension://test"));
}

#[tokio::test]
async fn host_rejects_other_homes_and_stops_accepting_after_drop() {
    let home = tempfile::tempdir().unwrap();
    let host = Host::start(home.path()).unwrap();
    let endpoint: Endpoint = serde_json::from_str(&host.endpoint).unwrap();
    let mut connection = pipe::connect(&endpoint).await.unwrap();
    pipe::write(
        &mut connection,
        &Request {
            argument: format!("--chrome-mcp={}", "0".repeat(64)),
            streams: [0; 3],
        },
    )
    .await
    .unwrap();
    assert!(!pipe::read::<bool>(&mut connection).await.unwrap());
    drop(connection);
    drop(host);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if pipe::server(endpoint.channel, true).is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn handshake_requires_a_complete_bounded_message() {
    let (mut sender, mut receiver) = tokio::io::duplex(2048);
    sender.write_all(&vec![b'x'; 1025]).await.unwrap();
    assert!(pipe::read::<Request>(&mut receiver).await.is_err());
    let (mut sender, mut receiver) = tokio::io::duplex(2048);
    sender.write_all(b"false").await.unwrap();
    drop(sender);
    assert!(pipe::read::<bool>(&mut receiver).await.is_err());
}

#[test]
fn peer_validation_rejects_an_unrelated_executable() {
    let child = std::process::Command::new("cmd.exe")
        .args(["/c", "exit", "0"])
        .spawn()
        .unwrap();
    assert!(native::Peer::open(child.id()).is_err());
    let mut child = child;
    child.wait().unwrap();
    assert!(native::Peer::open(std::process::id()).is_ok());
}
