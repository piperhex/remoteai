use std::{
    fs::{File, Metadata},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{atomic::AtomicBool, Arc},
    time::SystemTime,
};

use super::super::error::{GuiError, Result};
use super::manifest::Manifest;
use super::{StreamChunk, StreamInfo, StreamKind, StreamRead, CHUNK_BYTES};

pub(super) struct StreamFile {
    file: File,
    info: StreamInfo,
    modified: SystemTime,
    manifest: Option<Manifest>,
    pub(super) cancelled: Arc<AtomicBool>,
}

fn local_path(root: &Path, source: &str) -> Result<std::path::PathBuf> {
    let normalized = source.replace('\\', "/");
    let without_drive = if normalized.as_bytes().get(1) == Some(&b':')
        && normalized.as_bytes()[0].is_ascii_alphabetic()
        && normalized.as_bytes().get(2) == Some(&b'/')
    {
        &normalized[2..]
    } else {
        &normalized
    };
    if source.is_empty()
        || source.len() > 4096
        || source.chars().any(char::is_control)
        || normalized.starts_with("//")
        || without_drive.contains(':')
        || !root.is_absolute()
    {
        return Err(GuiError::FileRead);
    }
    let root = root.canonicalize().map_err(|_| GuiError::FileRead)?;
    let path = root
        .join(source)
        .canonicalize()
        .map_err(|_| GuiError::FileRead)?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(GuiError::FileRead);
    }
    Ok(path)
}

fn check_size(metadata: &Metadata, max_bytes: u64) -> Result<()> {
    if !metadata.is_file() {
        return Err(GuiError::FileRead);
    }
    if metadata.len() > max_bytes {
        return Err(GuiError::FileTooLarge);
    }
    Ok(())
}

fn video_mime_type(path: &Path, file: &mut File) -> Result<&'static str> {
    let mut header = [0; 12];
    file.read_exact(&mut header)
        .map_err(|_| GuiError::FileRead)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp4" | "m4v" if &header[4..8] == b"ftyp" => Ok("video/mp4"),
        "mov"
            if [&b"ftyp"[..], &b"moov"[..], &b"mdat"[..], &b"wide"[..]]
                .contains(&&header[4..8]) =>
        {
            Ok("video/quicktime")
        }
        "webm" if header[..4] == [0x1a, 0x45, 0xdf, 0xa3] => Ok("video/webm"),
        _ => Err(GuiError::VideoPreview),
    }
}

impl StreamFile {
    /// A private, automatically deleted snapshot keeps previews on the normal download transport.
    /// The content revision is stable across reopened snapshots, allowing verified blocks to resume.
    pub(super) fn snapshot(bytes: &[u8], name: String, mime_type: String) -> Result<Self> {
        use sha2::{Digest, Sha256};
        let mut file = tempfile::tempfile().map_err(|_| GuiError::FileRead)?;
        file.write_all(bytes).map_err(|_| GuiError::FileRead)?;
        let modified = file
            .metadata()
            .and_then(|value| value.modified())
            .map_err(|_| GuiError::FileRead)?;
        Ok(Self {
            file,
            info: StreamInfo {
                id: uuid::Uuid::new_v4().to_string(),
                size: bytes.len() as u64,
                name,
                mime_type,
                revision: format!("sha256:{:x}", Sha256::digest(bytes)),
            },
            modified,
            manifest: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub(super) fn open(
        root: &Path,
        source: &str,
        max_bytes: u64,
        kind: StreamKind,
    ) -> Result<Self> {
        let path = local_path(root, source)?;
        let mut file = File::open(&path).map_err(|_| GuiError::FileRead)?;
        let metadata = file.metadata().map_err(|_| GuiError::FileRead)?;
        check_size(&metadata, max_bytes)?;
        let mime_type = match kind {
            StreamKind::Video => video_mime_type(&path, &mut file)?.to_owned(),
            StreamKind::Download => mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string(),
        };
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(GuiError::FileRead)?
            .to_owned();
        let modified = metadata.modified().map_err(|_| GuiError::FileRead)?;
        let info = StreamInfo {
            id: uuid::Uuid::new_v4().to_string(),
            size: metadata.len(),
            mime_type,
            name,
            revision: format!("{}:{:?}", metadata.len(), modified),
        };
        Ok(Self {
            file,
            info,
            modified,
            manifest: None,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub(super) fn info(&self) -> StreamInfo {
        self.info.clone()
    }

    pub(super) fn manifest(&mut self, max_bytes: u64) -> Result<&Manifest> {
        self.check_source(max_bytes)?;
        if self.manifest.is_none() {
            self.manifest = Some(Manifest::scan(
                &mut self.file,
                &self.info.revision,
                &self.cancelled,
            )?);
        }
        self.manifest.as_ref().ok_or(GuiError::FileRead)
    }

    pub(super) fn bulk_read(&mut self, request: &super::bulk::BlockRead) -> Result<Vec<u8>> {
        self.check_source(request.max_bytes)?;
        let manifest = self.manifest.as_ref().ok_or(GuiError::InvalidRequest)?;
        if manifest.info.manifest_id != request.manifest_id {
            return Err(GuiError::FileChanged);
        }
        manifest.read(&mut self.file, request.block)
    }

    fn check_source(&self, max_bytes: u64) -> Result<()> {
        let metadata = self.file.metadata().map_err(|_| GuiError::FileRead)?;
        check_size(&metadata, max_bytes)?;
        if metadata.len() != self.info.size || metadata.modified().ok() != Some(self.modified) {
            return Err(GuiError::FileChanged);
        }
        Ok(())
    }

    pub(super) fn read(&mut self, request: &StreamRead) -> Result<StreamChunk> {
        if request.length == 0 || request.length > CHUNK_BYTES || request.offset >= self.info.size {
            return Err(GuiError::InvalidRequest);
        }
        self.check_source(request.max_bytes)?;
        let length = request.length.min(self.info.size - request.offset);
        let mut bytes = vec![0; length as usize];
        self.file
            .seek(SeekFrom::Start(request.offset))
            .map_err(|_| GuiError::FileRead)?;
        self.file
            .read_exact(&mut bytes)
            .map_err(|_| GuiError::FileRead)?;
        use base64::{engine::general_purpose::STANDARD, Engine};
        Ok(StreamChunk {
            offset: request.offset,
            data: STANDARD.encode(bytes),
        })
    }
}
