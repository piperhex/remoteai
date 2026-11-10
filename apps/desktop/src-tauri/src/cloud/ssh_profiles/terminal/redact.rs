//! Streaming redaction also covers passwords echoed across multiple SSH packets.
use zeroize::{Zeroize, Zeroizing};

const MAX_SECRETS: usize = 16;
const MAX_SECRET_BYTES: usize = 4096;
const REPLACEMENT: &[u8] = b"[redacted]";

#[derive(Default)]
pub(super) struct Redactor {
    secrets: Vec<Zeroizing<Vec<u8>>>,
    pending: Zeroizing<Vec<u8>>,
}

impl Redactor {
    pub(super) fn protect(&mut self, secret: &[u8]) -> bool {
        if secret.is_empty() || secret.len() > MAX_SECRET_BYTES {
            return false;
        }
        if self
            .secrets
            .iter()
            .any(|existing| existing.as_slice() == secret)
        {
            return true;
        }
        if self.secrets.len() == MAX_SECRETS {
            return false;
        }
        self.secrets.push(Zeroizing::new(secret.to_vec()));
        self.secrets
            .sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        true
    }

    pub(super) fn push(&mut self, data: &[u8], finished: bool) -> Vec<u8> {
        self.pending.extend_from_slice(data);
        let mut output = Vec::new();
        let mut offset = 0;
        while offset < self.pending.len() {
            let remaining = &self.pending[offset..];
            if let Some(secret) = self
                .secrets
                .iter()
                .find(|secret| remaining.starts_with(secret))
            {
                output.extend_from_slice(REPLACEMENT);
                offset += secret.len();
            } else if self
                .secrets
                .iter()
                .any(|secret| secret.starts_with(remaining))
            {
                if finished {
                    output.extend_from_slice(REPLACEMENT);
                    offset = self.pending.len();
                }
                break;
            } else {
                output.push(self.pending[offset]);
                offset += 1;
            }
        }
        self.pending[..offset].zeroize();
        self.pending.drain(..offset);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_boundaries_and_incomplete_echoes_never_expose_the_saved_password() {
        let mut redactor = Redactor::default();
        assert!(redactor.protect(b"secret-password"));
        assert_eq!(redactor.push(b"prompt: sec", false), b"prompt: ");
        assert!(redactor.push(b"ret-pass", false).is_empty());
        assert_eq!(redactor.push(b"word\r\nok", false), b"[redacted]\r\nok");
        assert_eq!(redactor.push(b"secr", true), b"[redacted]");
    }
}
