use super::{session::*, *};

const DESKTOP_PUBLIC: &str = "13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d";
const CLIENT_PUBLIC: &str = "57db4b359f23ae5e146e4e2512056704722506348c150c14753d0c933d04d421";

fn request(desktop: bool) -> Open {
    Open {
        secret: vec![if desktop { 7 } else { 9 }; 32],
        public_key: if desktop {
            CLIENT_PUBLIC
        } else {
            DESKTOP_PUBLIC
        }
        .into(),
        session_id: "interop-test".into(),
        desktop,
    }
}

#[test]
fn interoperates_with_existing_noble_wire_and_bulk_keys() {
    // Fixed output from the existing Web @noble implementation, not this Rust encoder.
    let payload = concat!(
        "000000020000000000000001",
        "d432e2fd21c42b91ca1cc0fd5f02ce940de07ffd",
        "0276651560066271dec31256fccb5424"
    );
    let mut desktop = Session::open(request(true)).unwrap();
    assert_eq!(
        desktop.decrypt(payload).unwrap().as_deref(),
        Some("Native chat: Unicode")
    );
    assert_eq!(desktop.decrypt(payload).unwrap(), None);
    let context = BulkContext {
        transfer_id: "transfer".into(),
        manifest_id: "manifest".into(),
        epoch: "epoch".into(),
    };
    let keys = desktop.bulk_keys(context.clone()).unwrap();
    assert_eq!(
        hex::encode(keys.send_key),
        "ed3709ef4c5798671c6d46e4b7315d065f6d8910792f7b011c7d62253d66a14a"
    );
    assert_eq!(
        hex::encode(keys.receive_key),
        "55bce31b32ff86dceb2e1a95b0d56def0dd13c502f655277467a0b90a9b6971a"
    );
    assert!(desktop.bulk_keys(context).is_err());
}

#[test]
fn authenticates_before_advancing_replay_window_and_decompressing() {
    let mut desktop = Session::open(request(true)).unwrap();
    let mut client = Session::open(request(false)).unwrap();
    for compress in [false, true] {
        let text = "聊天同步 😀\n".repeat(300);
        let packet = desktop.encrypt(&text, compress).unwrap();
        let mut corrupt = hex::decode(&packet).unwrap();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(client.decrypt(&hex::encode(corrupt)).is_err());
        assert!(desktop.decrypt(&packet).is_err());
        assert_eq!(client.decrypt(&packet).unwrap(), Some(text));
        assert_eq!(client.decrypt(&packet).unwrap(), None);
    }
    let old = desktop.encrypt("old", false).unwrap();
    for _ in 0..1025 {
        let packet = desktop.encrypt("new", false).unwrap();
        assert!(client.decrypt(&packet).unwrap().is_some());
    }
    assert_eq!(client.decrypt(&old).unwrap(), None);
}

#[test]
fn rejects_invalid_keys_payloads_and_unbounded_batches() {
    let mut invalid = request(true);
    invalid.public_key = "00".repeat(32);
    assert!(Session::open(invalid).is_err());
    let mut session = Session::open(request(true)).unwrap();
    for payload in ["0".repeat(55), "g".repeat(56), "0".repeat(40_002)] {
        assert!(session.decrypt(&payload).is_err());
    }
    assert!(session.encrypt(&"x".repeat(20_000), false).is_err());
    let state = State::default();
    let id = state.open(request(true)).unwrap();
    assert!(batch(&state, &id, Vec::new()).is_err());
    assert!(batch(
        &state,
        &id,
        (0..33)
            .map(|_| Operation::Encrypt {
                text: "x".into(),
                compress: false
            })
            .collect()
    )
    .is_err());
}

#[test]
fn direct_send_keeps_ciphertext_native_and_preserves_nested_path_framing() {
    let state = State::default();
    let id = state.open(request(true)).unwrap();
    let mut receiver = Session::open(request(false)).unwrap();
    for envelopes in 0..=2 {
        let result = batch(
            &state,
            &id,
            vec![Operation::Send {
                text: "native send".into(),
                compress: false,
                target: ChatTarget {
                    peer: "peer".into(),
                    channel: "channel".into(),
                    envelopes,
                },
            }],
        )
        .unwrap();
        assert_eq!(result.replies, vec![None]);
        let (target, mut packet) = result.sends.into_iter().next().unwrap();
        assert_eq!(target.peer, "peer");
        for _ in 0..envelopes {
            let (kind, payload): (String, String) = serde_json::from_str(&packet).unwrap();
            assert_eq!(kind, "data");
            packet = payload;
        }
        assert_eq!(
            receiver.decrypt(&packet).unwrap().as_deref(),
            Some("native send")
        );
    }
}
