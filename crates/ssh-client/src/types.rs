use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const MAX_SESSIONS: usize = 8;
// Base64 plus JSON stays below the authenticated relay's minimum message allowance.
pub const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
/// Per-request memory bound; chunked uploads have no total file-size limit.
pub const UPLOAD_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub type Result<T> = std::result::Result<T, Error>;

/// Stable localization keys are the only errors crossing the UI boundary.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("client.ssh.invalid")]
    Invalid,
    #[error("client.ssh.connectionFailed")]
    Connection,
    #[error("client.ssh.authenticationFailed")]
    Authentication,
    #[error("client.ssh.hostChanged")]
    HostKey,
    #[error("client.ssh.closed")]
    Closed,
    #[error("client.ssh.fileFailed")]
    File,
    #[error("client.runtimeErrors.tooManyRequestsTryAgainLater")]
    FileBusy,
    #[error("client.ssh.fileTooLarge")]
    FileTooLarge,
    #[error("client.ssh.conflict")]
    Conflict,
    #[error("client.ssh.limit")]
    Limit,
    #[error("client.ssh.x11InvalidDisplay")]
    X11Display,
    #[error("client.ssh.x11Unavailable")]
    X11Unavailable,
    #[error("client.ssh.x11Missing")]
    X11Missing,
    #[error("client.ssh.x11StartFailed")]
    X11Start,
    #[error("client.ssh.x11Rejected")]
    X11Rejected,
}

/// Forward to the X server on the computer that owns this SSH connection.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X11 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
}
impl X11 {
    pub fn validate(&self) -> Result<()> {
        if let Some(display) = self.display.as_deref().filter(|value| !value.is_empty()) {
            crate::x11::validate_display(display)?;
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}
impl Endpoint {
    pub fn validate(&self) -> Result<()> {
        if self.port == 0
            || self.host.is_empty()
            || self.host.len() > 253
            || self
                .host
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
            || self.host.contains(['/', '\\', '@'])
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connect {
    pub endpoint: Endpoint,
    pub username: String,
    pub fingerprint: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub size: Size,
    pub x11: Option<X11>,
}
impl Connect {
    pub fn validate(&self) -> Result<()> {
        self.endpoint.validate()?;
        self.size.validate()?;
        if let Some(x11) = &self.x11 {
            x11.validate()?;
        }
        if self.username.is_empty()
            || self.username.len() > 256
            || self.username.chars().any(char::is_control)
            || !self.fingerprint.starts_with("SHA256:")
            || self.fingerprint.len() > 100
            || self.password.as_ref().is_some_and(|s| s.len() > 4096)
            || self.passphrase.as_ref().is_some_and(|s| s.len() > 4096)
            || self
                .private_key
                .as_ref()
                .is_some_and(|s| s.len() > MAX_INPUT_BYTES)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}
impl Drop for Connect {
    fn drop(&mut self) {
        self.password.zeroize();
        self.private_key.zeroize();
        self.passphrase.zeroize();
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}
impl Size {
    pub fn validate(&self) -> Result<()> {
        if !(2..=500).contains(&self.cols) || !(1..=500).contains(&self.rows) {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub cwd: String,
    pub shell: String,
    pub ssh: Remote,
}
#[derive(Serialize)]
pub struct Remote {
    pub host: String,
    pub port: u16,
    pub username: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    Output { data: Vec<u8> },
    Exit { code: Option<u32> },
    Error { message: String },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Write {
        id: String,
        data: String,
    },
    /// Protocol bytes bypass UTF-8 encoding and shell-input markers.
    WriteBinary {
        id: String,
        data: Vec<u8>,
    },
    /// Bound delivery while a remote reader is transferring protocol bytes.
    OutputFlow {
        id: String,
        enabled: bool,
    },
    OutputAck {
        id: String,
        bytes: usize,
    },
    Resize {
        id: String,
        size: Size,
    },
    Close {
        id: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum FileAction {
    ReadChunk {
        path: String,
        offset: u64,
        length: u32,
    },
    List {
        path: String,
    },
    Read {
        path: String,
    },
    Upload {
        path: String,
        data: String,
    },
    CreateFolder {
        path: String,
    },
    Rename {
        path: String,
        destination: String,
    },
    Delete {
        path: String,
    },
    CreateFile {
        path: String,
    },
    DeleteTree {
        path: String,
    },
    UploadStart {
        path: String,
        size: u64,
        mode: UploadMode,
    },
    UploadChunk {
        token: String,
        offset: u64,
        data: String,
    },
    UploadFinish {
        token: String,
    },
    UploadCancel {
        token: String,
    },
}

/// An existing destination is only replaced after an explicit overwrite choice.
#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum UploadMode {
    Reject,
    Rename,
    Overwrite,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub directory: bool,
    pub size: u64,
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileReply {
    List {
        path: String,
        entries: Vec<Entry>,
        truncated: bool,
    },
    File {
        data: String,
    },
    Done,
    Upload {
        token: String,
    },
    Uploaded {
        path: String,
    },
}
