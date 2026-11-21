use crate::{files::validate_path, types::*, upload_destination};
use base64::{engine::general_purpose::STANDARD, Engine};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use std::{
    collections::HashMap,
    io::SeekFrom,
    time::{Duration, Instant},
};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

const MAX_UPLOADS: usize = 8;
const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

struct PendingUpload {
    temporary: String,
    destination: String,
    size: u64,
    written: u64,
    mode: UploadMode,
    touched: Instant,
}

impl PendingUpload {
    async fn prepare(sftp: &SftpSession, request: StartUpload, token: &str) -> Result<Self> {
        let StartUpload { path, size, mode } = request;
        validate_path(&path)?;
        let (_, name) = path.rsplit_once('/').ok_or(Error::Invalid)?;
        if !path.starts_with('/') || name.is_empty() || name == "." || name == ".." {
            return Err(Error::Invalid);
        }
        if mode == UploadMode::Reject && upload_destination::exists(sftp, &path).await? {
            return Err(Error::Conflict);
        }
        let path = if mode == UploadMode::Overwrite {
            upload_destination::overwrite_path(sftp, &path).await?
        } else {
            path
        };
        let (parent, name) = path.rsplit_once('/').ok_or(Error::Invalid)?;
        let parent = if parent.is_empty() { "/" } else { parent };
        let parent = sftp.canonicalize(parent).await.map_err(|_| Error::File)?;
        Ok(Self {
            temporary: format!("{}/.remoteai-upload-{token}", parent.trim_end_matches('/')),
            destination: format!("{}/{name}", parent.trim_end_matches('/')),
            size,
            mode,
            written: 0,
            touched: Instant::now(),
        })
    }
}

#[derive(Default)]
pub(crate) struct Uploads {
    pending: HashMap<String, PendingUpload>,
}
pub(crate) struct StartUpload {
    pub path: String,
    pub size: u64,
    pub mode: UploadMode,
}
pub(crate) struct WriteChunk {
    pub token: String,
    pub offset: u64,
    pub data: String,
}

impl Uploads {
    pub(crate) fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    pub(crate) async fn start(
        &mut self,
        sftp: &SftpSession,
        request: StartUpload,
    ) -> Result<FileReply> {
        if self.pending.len() >= MAX_UPLOADS {
            return Err(Error::File);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let upload = PendingUpload::prepare(sftp, request, &token).await?;
        let mut file = sftp
            .open_with_flags(
                &upload.temporary,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await
            .map_err(|_| Error::File)?;
        // Only a file successfully created by this upload belongs to its cleanup scope.
        let metadata = if upload.mode == UploadMode::Overwrite {
            upload_destination::preserve_metadata(sftp, &upload.destination, &upload.temporary)
                .await
        } else {
            Ok(())
        };
        self.pending.insert(token.clone(), upload);
        if file.shutdown().await.is_err() || metadata.is_err() {
            self.cancel(sftp, &token).await?;
            return Err(Error::File);
        }
        Ok(FileReply::Upload { token })
    }

    pub(crate) async fn chunk(
        &mut self,
        sftp: &SftpSession,
        request: WriteChunk,
    ) -> Result<FileReply> {
        let WriteChunk {
            token,
            offset,
            data,
        } = request;
        let bytes = decode_chunk(&data)?;
        let upload = self.pending.get_mut(&token).ok_or(Error::Invalid)?;
        let end = validate_range(offset, bytes.len(), upload.written, upload.size)?;
        upload.touched = Instant::now();
        let mut file = sftp
            .open_with_flags(&upload.temporary, OpenFlags::WRITE)
            .await
            .map_err(|_| Error::File)?;
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(|_| Error::File)?;
        file.write_all(&bytes).await.map_err(|_| Error::File)?;
        file.shutdown().await.map_err(|_| Error::File)?;
        upload.written = upload.written.max(end);
        Ok(FileReply::Done)
    }

    pub(crate) async fn finish(&mut self, sftp: &SftpSession, token: &str) -> Result<FileReply> {
        let upload = self.pending.get(token).ok_or(Error::Invalid)?;
        if upload.written != upload.size {
            return Err(Error::Invalid);
        }
        let path =
            upload_destination::publish(sftp, &upload.temporary, &upload.destination, upload.mode)
                .await?;
        self.pending.remove(token);
        Ok(FileReply::Uploaded { path })
    }

    pub(crate) async fn cancel(&mut self, sftp: &SftpSession, token: &str) -> Result<FileReply> {
        if let Some(upload) = self.pending.get(token) {
            if upload_destination::exists(sftp, &upload.temporary).await? {
                sftp.remove_file(&upload.temporary)
                    .await
                    .map_err(|_| Error::File)?;
            }
            self.pending.remove(token);
        }
        Ok(FileReply::Done)
    }

    pub(crate) async fn cleanup(&mut self, sftp: &SftpSession, all: bool) {
        let expired: Vec<_> = self
            .pending
            .iter()
            .filter(|(_, upload)| all || upload.touched.elapsed() >= UPLOAD_IDLE_TIMEOUT)
            .map(|(token, _)| token.clone())
            .collect();
        for token in expired {
            if self.cancel(sftp, &token).await.is_err() {
                eprintln!("SSH temporary upload cleanup failed");
            }
        }
    }
}

pub(crate) fn decode_chunk(data: &str) -> Result<Vec<u8>> {
    if data.len() > UPLOAD_CHUNK_BYTES.div_ceil(3) * 4 {
        return Err(Error::Invalid);
    }
    let bytes = STANDARD.decode(data).map_err(|_| Error::Invalid)?;
    if bytes.is_empty() || bytes.len() > UPLOAD_CHUNK_BYTES {
        return Err(Error::Invalid);
    }
    Ok(bytes)
}

pub(crate) fn validate_range(offset: u64, length: usize, written: u64, size: u64) -> Result<u64> {
    let end = offset.checked_add(length as u64).ok_or(Error::Invalid)?;
    // Retry a completed chunk safely, but reject gaps and partially overlapping writes.
    if end > size || offset > written || (offset < written && end > written) {
        return Err(Error::Invalid);
    }
    Ok(end)
}
