use super::*;

fn pair() -> (Codec, Codec) {
    let open = |desktop| Open {
        secret: vec![if desktop { 7 } else { 9 }; 32],
        public_key: hex::encode(x25519_dalek::x25519(
            [if desktop { 9 } else { 7 }; 32],
            x25519_dalek::X25519_BASEPOINT_BYTES,
        )),
        session_id: "tcp-interop".into(),
        desktop,
    };
    (
        Codec::new(open(true)).unwrap(),
        Codec::new(open(false)).unwrap(),
    )
}

fn receive(codec: &mut Codec, data: Vec<u8>) -> Output {
    codec.batch(vec![Operation::Receive { data }]).unwrap()
}

fn connect(left: &mut Codec, right: &mut Codec) {
    let left_hello = left.hello().writes.remove(0);
    let right_hello = right.hello().writes.remove(0);
    let proof_left = receive(left, right_hello).writes.remove(0);
    let proof_right = receive(right, left_hello).writes.remove(0);
    assert!(receive(left, proof_right).open);
    assert!(receive(right, proof_left).open);
}

#[test]
fn tcp_handles_fragmented_and_coalesced_frames_in_both_directions() {
    let (mut left, mut right) = pair();
    connect(&mut left, &mut right);
    for reverse in [false, true] {
        let (sender, receiver) = if reverse {
            (&mut right, &mut left)
        } else {
            (&mut left, &mut right)
        };
        let text = "聊天同步 😀".repeat(4096);
        let output = sender
            .batch(vec![
                Operation::Send { text: text.clone() },
                Operation::Send {
                    text: "next".into(),
                },
            ])
            .unwrap();
        let bytes = output.writes.concat();
        assert!(receive(receiver, bytes[..2].to_vec()).messages.is_empty());
        assert!(receive(receiver, bytes[2..11].to_vec()).messages.is_empty());
        assert_eq!(
            receive(receiver, bytes[11..].to_vec()).messages,
            vec![text, "next".into()]
        );
    }
}

#[test]
fn tcp_rejects_wrong_binding_tamper_replay_and_oversized_frames() {
    let (mut left, mut right) = pair();
    right.session = "wrong-session".into();
    let proof_left = receive(&mut left, right.hello().writes.remove(0))
        .writes
        .remove(0);
    receive(&mut right, left.hello().writes.remove(0));
    assert!(right
        .batch(vec![Operation::Receive { data: proof_left }])
        .is_err());
    for tamper in [false, true] {
        let (mut left, mut right) = pair();
        connect(&mut left, &mut right);
        let mut packet = left
            .batch(vec![Operation::Send {
                text: "private".into(),
            }])
            .unwrap()
            .writes
            .remove(0);
        if tamper {
            *packet.last_mut().unwrap() ^= 1;
        } else {
            receive(&mut right, packet.clone());
        }
        assert!(right
            .batch(vec![Operation::Receive { data: packet }])
            .is_err());
        assert!(right.batch(Vec::new()).is_err());
    }
    let (mut left, _) = pair();
    assert!(left
        .batch(vec![Operation::Receive {
            data: (MAX_FRAME as u32 + 1).to_be_bytes().to_vec()
        }])
        .is_err());
}

#[test]
fn tcp_unique_socket_keys_prevent_nonce_reuse() {
    let (mut left, mut right) = pair();
    connect(&mut left, &mut right);
    let (mut next_left, mut next_right) = pair();
    connect(&mut next_left, &mut next_right);
    let send = |codec: &mut Codec| {
        codec
            .batch(vec![Operation::Send {
                text: "same".into(),
            }])
            .unwrap()
            .writes
    };
    assert_ne!(send(&mut left), send(&mut next_left));
}
