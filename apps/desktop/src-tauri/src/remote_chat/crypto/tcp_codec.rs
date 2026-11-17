//! Wire-compatible TCP authentication and framing for peers predating native chat crypto.
use super::session::{CryptoError, Open, Result};
use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, KeyInit};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::Zeroizing;

pub(super) const MAX_FRAME: usize = 128 * 1024;
pub(super) const MAX_BATCH_BYTES: usize = 512 * 1024;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Operation {
    Send { text: String },
    Receive { data: Vec<u8> },
}

impl Operation {
    pub(super) fn bytes(&self) -> usize {
        match self {
            Self::Send { text } => text.len(),
            Self::Receive { data } => data.len(),
        }
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Output {
    pub writes: Vec<Vec<u8>>,
    pub messages: Vec<String>,
    pub open: bool,
}

pub(super) struct Codec {
    key: Zeroizing<[u8; 32]>,
    data_key: Option<Zeroizing<[u8; 32]>>,
    session: String,
    desktop: bool,
    nonce: String,
    remote_nonce: Option<String>,
    sent: u32,
    received: u32,
    buffer: Vec<u8>,
    failed: bool,
}

impl Codec {
    pub(super) fn new(request: Open) -> Result<Self> {
        let secret = Zeroizing::new(request.secret);
        let secret =
            Zeroizing::new(<[u8; 32]>::try_from(secret.as_slice()).map_err(|_| CryptoError)?);
        if request.public_key.len() != 64
            || request.session_id.is_empty()
            || request.session_id.len() > 256
        {
            return Err(CryptoError);
        }
        let public = hex::decode(request.public_key).map_err(|_| CryptoError)?;
        let public = public.as_slice().try_into().map_err(|_| CryptoError)?;
        let key = Zeroizing::new(x25519_dalek::x25519(*secret, public));
        if key.iter().all(|byte| *byte == 0) {
            return Err(CryptoError);
        }
        Ok(Self {
            key,
            data_key: None,
            session: request.session_id,
            desktop: request.desktop,
            nonce: hex::encode(rand::random::<[u8; 32]>()),
            remote_nonce: None,
            sent: 0,
            received: 0,
            buffer: Vec::new(),
            failed: false,
        })
    }

    pub(super) fn hello(&self) -> Output {
        Output {
            writes: vec![frame(format!("hello:{}", self.nonce).into_bytes())],
            ..Output::default()
        }
    }

    /// Any malformed input poisons the socket; an AEAD sequence is never reused after failure.
    pub(super) fn batch(&mut self, operations: Vec<Operation>) -> Result<Output> {
        if self.failed {
            return Err(CryptoError);
        }
        let mut output = Output::default();
        for operation in operations {
            let result = match operation {
                Operation::Send { text } => self.send(&text).map(|data| output.writes.push(data)),
                Operation::Receive { data } => self.receive(&data, &mut output),
            };
            if result.is_err() {
                self.failed = true;
                return Err(CryptoError);
            }
        }
        output.open = self.data_key.is_some();
        Ok(output)
    }

    fn send(&mut self, text: &str) -> Result<Vec<u8>> {
        if text.len() + 16 > MAX_FRAME {
            return Err(CryptoError);
        }
        self.sent = self.sent.checked_add(1).ok_or(CryptoError)?;
        let nonce = self.packet_nonce(self.sent, true);
        let key = self.data_key.as_ref().ok_or(CryptoError)?;
        let bytes = ChaCha20Poly1305::new(key.as_ref().into())
            .encrypt((&nonce).into(), text.as_bytes())
            .map_err(|_| CryptoError)?;
        Ok(frame(bytes))
    }

    fn receive(&mut self, mut data: &[u8], output: &mut Output) -> Result<()> {
        while !data.is_empty() {
            let take = data.len().min(MAX_FRAME + 4 - self.buffer.len());
            if take == 0 {
                return Err(CryptoError);
            }
            self.buffer.extend_from_slice(&data[..take]);
            data = &data[take..];
            self.drain(output)?;
        }
        Ok(())
    }

    fn drain(&mut self, output: &mut Output) -> Result<()> {
        while self.buffer.len() >= 4 {
            let size =
                u32::from_be_bytes(self.buffer[..4].try_into().map_err(|_| CryptoError)?) as usize;
            if size == 0 || size > MAX_FRAME || (self.data_key.is_none() && size > 256) {
                return Err(CryptoError);
            }
            if self.buffer.len() < size + 4 {
                return Ok(());
            }
            let packet = self.buffer[4..size + 4].to_vec();
            self.buffer.drain(..size + 4);
            if self.data_key.is_some() {
                output.messages.push(self.decrypt(&packet)?);
            } else {
                self.authenticate(&packet, output)?;
            }
        }
        Ok(())
    }

    fn packet_nonce(&self, sequence: u32, sending: bool) -> [u8; 12] {
        let mut nonce = [0; 12];
        nonce[..4]
            .copy_from_slice(&(if self.desktop == sending { 1_u32 } else { 2 }).to_be_bytes());
        nonce[8..].copy_from_slice(&sequence.to_be_bytes());
        nonce
    }

    fn decrypt(&mut self, packet: &[u8]) -> Result<String> {
        self.received = self.received.checked_add(1).ok_or(CryptoError)?;
        let nonce = self.packet_nonce(self.received, false);
        let key = self.data_key.as_ref().ok_or(CryptoError)?;
        let plain = ChaCha20Poly1305::new(key.as_ref().into())
            .decrypt((&nonce).into(), packet)
            .map_err(|_| CryptoError)?;
        String::from_utf8(plain).map_err(|_| CryptoError)
    }

    fn nonces(&self) -> Result<[&str; 2]> {
        let remote = self.remote_nonce.as_deref().ok_or(CryptoError)?;
        Ok(if self.desktop {
            [&self.nonce, remote]
        } else {
            [remote, &self.nonce]
        })
    }

    fn proof(&self, desktop: bool) -> Result<Hmac<Sha256>> {
        let nonces = self.nonces()?;
        let context =
            serde_json::to_vec(&("codex-tcp-v1", &self.session, desktop, nonces[0], nonces[1]))
                .map_err(|_| CryptoError)?;
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(self.key.as_ref()).map_err(|_| CryptoError)?;
        mac.update(&context);
        Ok(mac)
    }

    fn authenticate(&mut self, packet: &[u8], output: &mut Output) -> Result<()> {
        let text = std::str::from_utf8(packet).map_err(|_| CryptoError)?;
        if self.remote_nonce.is_none() {
            let nonce = token(text, "hello:")?;
            self.remote_nonce = Some(nonce.into());
            let proof = hex::encode(self.proof(self.desktop)?.finalize().into_bytes());
            output
                .writes
                .push(frame(format!("proof:{proof}").into_bytes()));
            return Ok(());
        }
        let proof = hex::decode(token(text, "proof:")?).map_err(|_| CryptoError)?;
        self.proof(!self.desktop)?
            .verify_slice(&proof)
            .map_err(|_| CryptoError)?;
        let salt = serde_json::to_vec(&self.nonces()?).map_err(|_| CryptoError)?;
        let mut key = Zeroizing::new([0; 32]);
        Hkdf::<Sha256>::new(Some(&salt), self.key.as_ref())
            .expand(
                format!("codex-tcp-data-v1:{}", self.session).as_bytes(),
                key.as_mut(),
            )
            .map_err(|_| CryptoError)?;
        self.data_key = Some(key);
        Ok(())
    }
}

fn token<'a>(text: &'a str, prefix: &str) -> Result<&'a str> {
    let value = text.strip_prefix(prefix).ok_or(CryptoError)?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(CryptoError);
    }
    Ok(value)
}

fn frame(bytes: Vec<u8>) -> Vec<u8> {
    [(bytes.len() as u32).to_be_bytes().as_slice(), &bytes].concat()
}

#[cfg(test)]
#[path = "tcp_tests.rs"]
mod tests;
