//! Native transfer access stays within registered bundle capabilities; no paths cross IPC.
use super::*;

pub(super) const BATCH_BYTES: usize = 1024 * 1024;

pub(super) struct Reader {
    pub file: File,
    pub size: u64,
    pub sha256: String,
}

pub(super) fn reader(id: &str, offset: u64) -> Result<Reader, String> {
    let mut entries = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    let entry = entries
        .get_mut(id)
        .filter(|entry| entry.touched.elapsed() < TRANSFER_TTL)
        .ok_or(INVALID)?;
    if entry.written != entry.size || offset > entry.size {
        return Err(INVALID.into());
    }
    entry.touched = Instant::now();
    let mut file = File::open(entry.root.join("bundle.zip")).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    Ok(Reader {
        file,
        size: entry.size,
        sha256: entry.sha256.clone(),
    })
}

pub(super) fn destination(id: &str, offset: u64, size: u64, hash: &str) -> Result<(), String> {
    let entries = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    let entry = entries
        .get(id)
        .filter(|entry| entry.touched.elapsed() < TRANSFER_TTL)
        .ok_or(INVALID)?;
    if entry.written != offset || entry.size != size || entry.sha256 != hash || offset > size {
        return Err(INVALID.into());
    }
    Ok(())
}

pub(super) fn write(id: &str, offset: u64, bytes: &[u8]) -> Result<u64, String> {
    let mut entries = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    let entry = entries
        .get_mut(id)
        .filter(|entry| entry.touched.elapsed() < TRANSFER_TTL)
        .ok_or(INVALID)?;
    write_bytes(entry, offset, bytes, BATCH_BYTES)?;
    // Durable bytes precede the durable acknowledged-prefix checkpoint.
    File::options()
        .write(true)
        .open(entry.root.join("bundle.zip"))
        .and_then(|file| file.sync_data())
        .map_err(|error| error.to_string())?;
    entry.touched = Instant::now();
    persistence::save(entry)?;
    Ok(entry.written)
}

pub(super) fn verify(id: &str) -> Result<(), String> {
    let entries = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    let entry = entries.get(id).ok_or(INVALID)?;
    if entry.written != entry.size || sha256(&entry.root.join("bundle.zip"))? != entry.sha256 {
        return Err(INVALID.into());
    }
    Ok(())
}
