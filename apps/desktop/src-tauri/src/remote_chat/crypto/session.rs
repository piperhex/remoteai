//! The existing chat wire format, with native key derivation, nonce allocation and replay protection.
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit,
};
use csw_chat_connectivity::packet_codec;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
use zeroize::Zeroizing;

const REPLAY_WINDOW: usize = 1024;
const MAX_EPOCHS: usize = 1024;
pub(super) const MAX_PACKET_BYTES: usize = 20_000;

#[derive(Debug, thiserror::Error)]
#[error("invalid chat crypto operation")]
pub(crate) struct CryptoError;
pub(super) type Result<T> = std::result::Result<T, CryptoError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Open {
    pub secret: Vec<u8>,
    pub public_key: String,
    pub session_id: String,
    pub desktop: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BulkContext {
    pub transfer_id: String,
    pub manifest_id: String,
    pub epoch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BulkKeys {
    pub send_key: Vec<u8>,
    pub receive_key: Vec<u8>,
}

pub(crate) struct Session {
    key: Zeroizing<[u8; 32]>,
    bulk_key: Zeroizing<[u8; 32]>,
    context: Vec<u8>,
    session_id: String,
    desktop_key: String,
    client_key: String,
    desktop: bool,
    sent: u32,
    highest: u32,
    received: [u32; REPLAY_WINDOW],
    epochs: HashSet<String>,
}

fn derive(root: &[u8], salt: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(Some(salt), root)
        .expand(info, key.as_mut())
        .map_err(|_| CryptoError)?;
    Ok(key)
}

impl Session {
    pub(super) fn open(request: Open) -> Result<Self> {
        let secret = Zeroizing::new(request.secret);
        if secret.len() != 32 || request.public_key.len() != 64 {
            return Err(CryptoError);
        }
        let secret: [u8; 32] = secret.as_slice().try_into().map_err(|_| CryptoError)?;
        let secret = Zeroizing::new(secret);
        let public: [u8; 32] = hex::decode(&request.public_key)
            .map_err(|_| CryptoError)?
            .try_into()
            .map_err(|_| CryptoError)?;
        if request.session_id.is_empty() || request.session_id.len() > 256 {
            return Err(CryptoError);
        }
        let shared = Zeroizing::new(x25519_dalek::x25519(*secret, public));
        if shared.iter().all(|byte| *byte == 0) {
            return Err(CryptoError);
        }
        let local = hex::encode(x25519_dalek::x25519(
            *secret,
            x25519_dalek::X25519_BASEPOINT_BYTES,
        ));
        let context = format!("codex-switch-chat-v1:{}", request.session_id).into_bytes();
        let key = derive(shared.as_ref(), &context, b"chat encryption")?;
        let bulk_key = derive(key.as_ref(), &context, b"file bulk root v1")?;
        let (desktop_key, client_key) = if request.desktop {
            (local, request.public_key)
        } else {
            (request.public_key, local)
        };
        Ok(Self {
            key,
            bulk_key,
            context,
            session_id: request.session_id,
            desktop_key,
            client_key,
            desktop: request.desktop,
            sent: 0,
            highest: 0,
            received: [0; REPLAY_WINDOW],
            epochs: HashSet::new(),
        })
    }

    pub(super) fn encrypt(&mut self, text: &str, compress: bool) -> Result<String> {
        if text.len() > packet_codec::MAX_PLAIN_BYTES {
            return Err(CryptoError);
        }
        let compressed = if compress {
            packet_codec::encode_packet(text.as_bytes()).map_err(|_| CryptoError)?
        } else {
            None
        };
        self.sent = self.sent.checked_add(1).ok_or(CryptoError)?;
        let mut nonce = [0_u8; 12];
        nonce[..4].copy_from_slice(&(if self.desktop { 1_u32 } else { 2 }).to_be_bytes());
        nonce[4..8].copy_from_slice(&u32::from(compressed.is_some()).to_be_bytes());
        nonce[8..].copy_from_slice(&self.sent.to_be_bytes());
        let bytes = compressed.as_deref().unwrap_or(text.as_bytes());
        let cipher = ChaCha20Poly1305::new(self.key.as_ref().into());
        let encrypted = cipher
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: bytes,
                    aad: &self.context,
                },
            )
            .map_err(|_| CryptoError)?;
        Ok(hex::encode(
            [nonce.as_slice(), encrypted.as_slice()].concat(),
        ))
    }

    pub(super) fn decrypt(&mut self, payload: &str) -> Result<Option<String>> {
        if !(56..=MAX_PACKET_BYTES * 2).contains(&payload.len())
            || !payload
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(CryptoError);
        }
        let bytes = hex::decode(payload).map_err(|_| CryptoError)?;
        let nonce: &[u8; 12] = bytes[..12].try_into().map_err(|_| CryptoError)?;
        let direction = u32::from_be_bytes(nonce[..4].try_into().map_err(|_| CryptoError)?);
        let flag = u32::from_be_bytes(nonce[4..8].try_into().map_err(|_| CryptoError)?);
        let sequence = u32::from_be_bytes(nonce[8..].try_into().map_err(|_| CryptoError)?);
        if direction != if self.desktop { 2 } else { 1 } || flag > 1 || sequence == 0 {
            return Err(CryptoError);
        }
        let slot = sequence as usize % REPLAY_WINDOW;
        if self.received[slot] == sequence
            || sequence <= self.highest.saturating_sub(REPLAY_WINDOW as u32)
        {
            return Ok(None);
        }
        let cipher = ChaCha20Poly1305::new(self.key.as_ref().into());
        let plain = cipher
            .decrypt(
                nonce.into(),
                Payload {
                    msg: &bytes[12..],
                    aad: &self.context,
                },
            )
            .map_err(|_| CryptoError)?;
        let plain = if flag == 1 {
            packet_codec::decode_packet(&plain).map_err(|_| CryptoError)?
        } else {
            plain
        };
        let text = String::from_utf8(plain).map_err(|_| CryptoError)?;
        self.received[slot] = sequence;
        self.highest = self.highest.max(sequence);
        Ok(Some(text))
    }

    pub(crate) fn bulk_keys(&mut self, context: BulkContext) -> Result<BulkKeys> {
        if self.epochs.len() >= MAX_EPOCHS
            || self.epochs.contains(&context.epoch)
            || [&context.transfer_id, &context.manifest_id, &context.epoch]
                .iter()
                .any(|value| value.is_empty() || value.len() > 256)
        {
            return Err(CryptoError);
        }
        let binding = serde_json::to_vec(&[
            "remote-ai:file-bulk:v1",
            &self.session_id,
            &self.desktop_key,
            &self.client_key,
            &context.transfer_id,
            &context.manifest_id,
            &context.epoch,
        ])
        .map_err(|_| CryptoError)?;
        let send = if self.desktop {
            b"desktop-to-client"
        } else {
            b"client-to-desktop"
        };
        let receive = if self.desktop {
            b"client-to-desktop"
        } else {
            b"desktop-to-client"
        };
        let send_key = derive(self.bulk_key.as_ref(), &binding, send)?.to_vec();
        let receive_key = derive(self.bulk_key.as_ref(), &binding, receive)?.to_vec();
        self.epochs.insert(context.epoch);
        Ok(BulkKeys {
            send_key,
            receive_key,
        })
    }
}
