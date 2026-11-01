//! Incremental hashing and UTF-8 validation. Memory use does not depend on file length.
use super::*;
use std::io::Seek;
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) const BUFFER_BYTES: usize = 64 * 1024;

pub(super) struct Scan {
    pub revision: String,
    pub size: u64,
    pub text: bool,
    pub inline: Vec<u8>,
}

#[derive(Default)]
struct Utf8 {
    pending: Vec<u8>,
    invalid: bool,
}

impl Utf8 {
    fn update(&mut self, bytes: &[u8]) {
        if self.invalid {
            return;
        }
        self.pending.extend_from_slice(bytes);
        if self.pending.contains(&0) {
            self.invalid = true;
            return;
        }
        match std::str::from_utf8(&self.pending) {
            Ok(_) => self.pending.clear(),
            Err(error) if error.error_len().is_none() => {
                self.pending.drain(..error.valid_up_to());
            }
            Err(_) => self.invalid = true,
        }
    }
}

pub(super) fn scan(
    file: &mut File,
    mut copy: Option<&mut dyn Write>,
    limit: usize,
    cancelled: Option<&AtomicBool>,
) -> Result<Scan> {
    // A log that keeps growing must not turn one read into an endless scan/copy.
    // Callers check the original metadata/digest and reject a changed source afterwards.
    let length = file.metadata().map_err(|_| GuiError::FileRead)?.len();
    let position = file.stream_position().map_err(|_| GuiError::FileRead)?;
    let mut input = file.take(length.saturating_sub(position));
    let mut hash = Sha256::new();
    let mut utf8 = Utf8::default();
    let mut buffer = vec![0; BUFFER_BYTES];
    let mut inline = Vec::new();
    let mut size = 0u64;
    loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(GuiError::FileExpired);
        }
        let count = input.read(&mut buffer).map_err(|_| GuiError::FileRead)?;
        if count == 0 {
            break;
        }
        let bytes = &buffer[..count];
        if let Some(output) = copy.as_mut() {
            output
                .write_all(bytes)
                .map_err(|_| GuiError::ProjectFileWrite)?;
        }
        hash.update(bytes);
        utf8.update(bytes);
        size += count as u64;
        if size <= limit as u64 {
            inline.extend_from_slice(bytes);
        } else {
            inline.clear();
        }
    }
    Ok(Scan {
        revision: format!("{:x}", hash.finalize()),
        size,
        text: !utf8.invalid && utf8.pending.is_empty(),
        inline,
    })
}

pub(super) fn inspect(path: &Path) -> Result<Scan> {
    let mut file = File::open(path).map_err(|_| GuiError::FileRead)?;
    let before = file.metadata().map_err(|_| GuiError::FileRead)?;
    let result = scan(&mut file, None, 0, None)?;
    unchanged(path, &before)?;
    Ok(result)
}

pub(super) fn copy_range(
    source: &mut File,
    destination: &mut dyn Write,
    length: u64,
    cancelled: &AtomicBool,
) -> Result<()> {
    let mut remaining = length;
    let mut buffer = vec![0; BUFFER_BYTES];
    while remaining > 0 {
        if cancelled.load(Ordering::Relaxed) {
            return Err(GuiError::FileExpired);
        }
        let count = (remaining.min(BUFFER_BYTES as u64)) as usize;
        source
            .read_exact(&mut buffer[..count])
            .map_err(|_| GuiError::FileRead)?;
        destination
            .write_all(&buffer[..count])
            .map_err(|_| GuiError::ProjectFileWrite)?;
        remaining -= count as u64;
    }
    Ok(())
}

pub(super) fn unchanged(path: &Path, before: &fs::Metadata) -> Result<()> {
    let after = fs::metadata(path).map_err(|_| GuiError::ProjectFileConflict)?;
    if before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
        || before.created().ok() != after.created().ok()
    {
        return Err(GuiError::ProjectFileConflict);
    }
    Ok(())
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod tests;
