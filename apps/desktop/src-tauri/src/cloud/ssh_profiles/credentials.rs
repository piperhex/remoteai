use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const MAX_PASSWORD_BYTES: usize = 4096;
const MAX_PRIVATE_KEY_BYTES: usize = 65536;

/// Login material exists only while saving or opening a connection, never in profile metadata.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshCredentials {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    private_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    passphrase: Option<String>,
}

impl SshCredentials {
    pub(super) fn apply(mut self, request: &mut csw_ssh_client::Connect) {
        request.password = self.password.take();
        request.private_key = self.private_key.take();
        request.passphrase = self.passphrase.take();
    }

    pub(super) fn valid(&self) -> bool {
        valid_secret(&self.password, MAX_PASSWORD_BYTES)
            && valid_secret(&self.private_key, MAX_PRIVATE_KEY_BYTES)
            && valid_secret(&self.passphrase, MAX_PASSWORD_BYTES)
            && !(self.password.is_some()
                && (self.private_key.is_some() || self.passphrase.is_some()))
            && (self.passphrase.is_none() || self.private_key.is_some())
    }

    pub(super) fn matches_auth(&self, auth: &super::Authentication) -> bool {
        self.valid()
            && match auth {
                super::Authentication::Password => {
                    self.private_key.is_none() && self.passphrase.is_none()
                }
                super::Authentication::Key => self.password.is_none(),
            }
    }
}

impl Drop for SshCredentials {
    fn drop(&mut self) {
        self.password.zeroize();
        self.private_key.zeroize();
        self.passphrase.zeroize();
    }
}

fn valid_secret(value: &Option<String>, limit: usize) -> bool {
    value
        .as_ref()
        .is_none_or(|value| value.len() <= limit && !value.contains('\0'))
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SshCredentialReply {
    pub(super) credentials: Option<SshCredentials>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_bounded_passwords_and_encrypted_keys_without_debug_serialization() {
        for value in [
            json!({"password":"secret"}),
            json!({"privateKey":"key", "passphrase":"phrase"}),
        ] {
            let secret: SshCredentials = serde_json::from_value(value).unwrap();
            assert!(secret.valid());
        }
        for value in [
            json!({"password":"x".repeat(MAX_PASSWORD_BYTES + 1)}),
            json!({"password":"bad\0value"}),
            json!({"password":"secret", "privateKey":"key"}),
            json!({"passphrase":"missing-key"}),
        ] {
            let secret: SshCredentials = serde_json::from_value(value).unwrap();
            assert!(!secret.valid());
        }
        assert!(serde_json::from_value::<SshCredentials>(json!({"ownerId":"other"})).is_err());
    }
}
