use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};

pub(super) mod network_fixture;

// A deterministic test-only key. Never reads or uses the release signing key.
pub(super) fn signed(bytes: &[u8]) -> (String, String) {
    let key = SigningKey::from_bytes(&[42; 32]);
    let signature = key.sign(bytes).to_bytes();
    let prefix = b"Ed12345678";
    let public = [prefix.as_slice(), key.verifying_key().as_bytes()].concat();
    let message = [prefix.as_slice(), &signature].concat();
    let global = key.sign(&[signature.as_slice(), b"test artifact"].concat());
    let public = format!("untrusted comment: test key\n{}", STANDARD.encode(public));
    let signature = format!(
        "untrusted comment: test signature\n{}\ntrusted comment: test artifact\n{}",
        STANDARD.encode(message),
        STANDARD.encode(global.to_bytes())
    );
    (STANDARD.encode(public), STANDARD.encode(signature))
}

#[test]
fn artifact_ids_cannot_be_paths() {
    assert!(cache::valid_id(&"a".repeat(64)));
    for value in ["../installer", "", "/tmp/file", "A"] {
        assert!(!cache::valid_id(value));
    }
}
