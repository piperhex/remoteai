use super::super::{
    snapshot::{digest, BLOCK_BYTES},
    Error, Result, MAX_PACKAGE_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub(super) const CHECKPOINT_BYTES: usize = 8 * 1024 * 1024;
pub(super) const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(2);
const MAX_LEDGER_BYTES: u64 = 128 * 1024;

#[derive(Deserialize, Serialize)]
struct Ledger {
    size: usize,
    hashes: Vec<Option<String>>,
}

/// The in-memory ledger includes pending blocks; it is serialized only AFTER data sync succeeds.
pub(super) struct Files {
    file: File,
    path: PathBuf,
    ledger_path: PathBuf,
    ledger: Ledger,
    pending: usize,
    dirty_since: Option<Instant>,
    #[cfg(test)]
    pub(super) probe: Probe,
}

#[cfg(test)]
#[derive(Default)]
pub(super) struct Probe {
    pub(super) interrupt: Option<&'static str>,
    pub(super) data_syncs: usize,
    pub(super) ledger_syncs: usize,
    pub(super) replaces: usize,
}

impl Files {
    pub(super) fn open(directory: PathBuf, id: String, size: usize) -> Result<(Self, Vec<bool>)> {
        if !super::super::cache::valid_id(&id) || size == 0 || size > MAX_PACKAGE_BYTES {
            return Err(Error::Invalid);
        }
        fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{id}.partial"));
        let ledger_path = directory.join(format!("{id}.json"));
        prune(&directory, &id)?;
        if fs::symlink_metadata(&path).is_ok_and(|info| !info.is_file()) {
            return Err(Error::Invalid);
        }
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;
        // Do not allow a new download to race a cancelled writer's final flush, including other processes.
        file.try_lock().map_err(|_| Error::Unavailable)?;
        let mut ledger = read_ledger(&ledger_path, size);
        restore(&mut file, &mut ledger)?;
        file.set_len(size as u64)?;
        let done = ledger.hashes.iter().map(Option::is_some).collect();
        Ok((
            Self {
                file,
                path,
                ledger_path,
                ledger,
                pending: 0,
                dirty_since: None,
                #[cfg(test)]
                probe: Probe::default(),
            },
            done,
        ))
    }

    pub(super) fn write(&mut self, index: usize, bytes: &[u8]) -> Result<()> {
        if index >= self.ledger.hashes.len()
            || bytes.len() != BLOCK_BYTES.min(self.ledger.size - index * BLOCK_BYTES)
        {
            return Err(Error::Invalid);
        }
        // Endgame duplicates must never overwrite a previously committed range.
        if self.ledger.hashes[index].is_some() {
            return Ok(());
        }
        self.file
            .seek(SeekFrom::Start((index * BLOCK_BYTES) as u64))?;
        self.point("data_write")?;
        self.file.write_all(bytes)?;
        self.point("after_data_write")?;
        self.ledger.hashes[index] = Some(digest(bytes));
        self.pending += bytes.len();
        self.dirty_since.get_or_insert_with(Instant::now);
        if self.pending >= CHECKPOINT_BYTES || self.wait().is_zero() {
            self.flush()?;
        }
        Ok(())
    }

    pub(super) fn wait(&self) -> Duration {
        self.dirty_since.map_or(CHECKPOINT_INTERVAL, |since| {
            CHECKPOINT_INTERVAL.saturating_sub(since.elapsed())
        })
    }

    pub(super) fn flush(&mut self) -> Result<()> {
        if self.pending == 0 {
            return Ok(());
        }
        self.point("data_sync")?;
        // Also persist the preallocated file length before publishing any range.
        self.file.sync_all()?;
        #[cfg(test)]
        {
            self.probe.data_syncs += 1;
        }
        self.point("after_data_sync")?;
        let data = serde_json::to_vec(&self.ledger).map_err(|_| Error::Invalid)?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(self.path.parent().ok_or(Error::Invalid)?)?;
        self.point("ledger_write")?;
        temporary.write_all(&data)?;
        self.point("ledger_sync")?;
        temporary.as_file().sync_all()?;
        #[cfg(test)]
        {
            self.probe.ledger_syncs += 1;
        }
        self.point("replace")?;
        super::platform::replace(temporary, &self.ledger_path)?;
        #[cfg(test)]
        {
            self.probe.replaces += 1;
        }
        self.point("after_replace")?;
        self.pending = 0;
        self.dirty_since = None;
        Ok(())
    }

    pub(super) fn finish(&mut self, size: usize) -> Result<Vec<u8>> {
        if size != self.ledger.size || self.ledger.hashes.iter().any(Option::is_none) {
            return Err(Error::Invalid);
        }
        self.flush()?;
        self.file.seek(SeekFrom::Start(0))?;
        let mut bytes = vec![0; size];
        self.file.read_exact(&mut bytes)?;
        // A failed upstream digest/signature must never leave a fully downloaded poisoned ledger.
        remove(&self.ledger_path)?;
        remove(&self.path)?;
        Ok(bytes)
    }

    fn point(&self, _stage: &'static str) -> Result<()> {
        #[cfg(test)]
        if self.probe.interrupt == Some(_stage) {
            return Err(std::io::Error::other("injected checkpoint interruption").into());
        }
        Ok(())
    }
}

fn read_ledger(path: &Path, size: usize) -> Ledger {
    let loaded = (|| {
        let metadata = fs::symlink_metadata(path).ok()?;
        if !metadata.is_file() || metadata.len() > MAX_LEDGER_BYTES {
            return None;
        }
        let ledger: Ledger = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
        (ledger.size == size && ledger.hashes.len() == size.div_ceil(BLOCK_BYTES)).then_some(ledger)
    })();
    loaded.unwrap_or_else(|| Ledger {
        size,
        hashes: vec![None; size.div_ceil(BLOCK_BYTES)],
    })
}

fn restore(file: &mut File, ledger: &mut Ledger) -> Result<()> {
    if file.metadata()?.len() != ledger.size as u64 {
        ledger.hashes.fill(None);
        return Ok(());
    }
    for (index, hash) in ledger.hashes.iter_mut().enumerate() {
        let Some(expected) = hash.as_ref() else {
            continue;
        };
        let mut bytes = vec![0; BLOCK_BYTES.min(ledger.size - index * BLOCK_BYTES)];
        file.seek(SeekFrom::Start((index * BLOCK_BYTES) as u64))?;
        file.read_exact(&mut bytes)?;
        if digest(&bytes) != *expected {
            *hash = None;
        }
    }
    Ok(())
}

fn remove(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn prune(directory: &Path, current: &str) -> Result<()> {
    let mut entries = fs::read_dir(directory)?
        .filter_map(std::result::Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "partial")
        })
        .filter(|entry| {
            entry
                .path()
                .file_stem()
                .and_then(|id| id.to_str())
                .is_some_and(|id| id != current && super::super::cache::valid_id(id))
        })
        .collect::<Vec<_>>();
    entries
        .sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok()));
    for entry in entries.into_iter().skip(1) {
        // Active/cancelling downloads cannot be pruned by another package.
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(entry.path())?;
        if file.try_lock().is_err() {
            continue;
        }
        remove(&entry.path().with_extension("json"))?;
        remove(&entry.path())?;
    }
    Ok(())
}
