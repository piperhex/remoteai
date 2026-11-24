//! A linked checkout is a separate directory, not an exclusive writer. These fingerprints
//! only describe workspace changes and are never consumed by the turn diff or undo.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_FILES: usize = 32_000;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const SCAN_TIME: Duration = Duration::from_secs(4);
const MAX_RESULTS: usize = 1_000;

pub(super) struct Baseline {
    directory: PathBuf,
    files: Option<BTreeMap<String, [u8; 32]>>,
}

#[derive(Serialize)]
pub(super) struct Observation {
    paths: Vec<String>,
    complete: bool,
}

impl Baseline {
    pub(super) fn start(cwd: &str) -> Option<Self> {
        let directory = super::protocol::directory(cwd).ok()?;
        let root = directory
            .ancestors()
            .find(|path| path.join(".git").exists())?;
        if !root.join(".git").is_file() {
            return None;
        }
        let layout = super::git::run(
            root,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-dir",
                "--git-common-dir",
            ],
        )
        .ok()?;
        let layout = std::str::from_utf8(&layout.stdout).ok()?;
        let mut lines = layout.lines();
        if lines.next()? == lines.next()? {
            return None;
        }
        Some(Self {
            files: fingerprints(&directory).ok(),
            directory,
        })
    }

    pub(super) fn finish(self) -> Observation {
        let Some((before, after)) = self.files.and_then(|before| {
            fingerprints(&self.directory)
                .ok()
                .map(|after| (before, after))
        }) else {
            return Observation {
                paths: Vec::new(),
                complete: false,
            };
        };
        let paths: BTreeSet<_> = before
            .keys()
            .chain(after.keys())
            .filter(|key| before.get(*key) != after.get(*key))
            .collect();
        Observation {
            complete: paths.len() <= MAX_RESULTS,
            paths: paths.into_iter().take(MAX_RESULTS).cloned().collect(),
        }
    }
}

fn fingerprints(directory: &Path) -> io::Result<BTreeMap<String, [u8; 32]>> {
    let started = Instant::now();
    let mut files = BTreeMap::new();
    let mut remaining = MAX_BYTES;
    let mut pending = vec![directory.to_owned()];
    let mut visited = BTreeSet::new();
    while let Some(root) = pending.pop() {
        if !visited.insert(root.canonicalize()?) {
            return Err(io::Error::other("Repeated repository"));
        }
        let output = super::git::run(
            &root,
            &[
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                ".",
            ],
        )
        .map_err(io::Error::other)?;
        if !output.status.success() {
            return Err(io::Error::other("Git listing failed"));
        }
        let names = std::str::from_utf8(&output.stdout).map_err(io::Error::other)?;
        for name in names.split_terminator('\0') {
            if started.elapsed() > SCAN_TIME || files.len() >= MAX_FILES {
                return Err(io::Error::other("Scan limit"));
            }
            let path = root.join(name);
            let metadata = match path.symlink_metadata() {
                Ok(value) => value,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let parent = path
                .parent()
                .ok_or_else(|| io::Error::other("Invalid path"))?;
            if !parent.canonicalize()?.starts_with(directory) {
                return Err(io::Error::other("Directory changed"));
            }
            let key = path
                .strip_prefix(directory)
                .map_err(io::Error::other)?
                .to_string_lossy()
                .replace('\\', "/");
            if metadata.is_dir() && !metadata.is_symlink() {
                if path.join(".git").exists() && path.canonicalize()?.starts_with(directory) {
                    pending.push(path);
                } else {
                    return Err(io::Error::other("Directory contents unavailable"));
                }
            } else {
                files.insert(key, fingerprint(&path, &metadata, &mut remaining)?);
            }
        }
    }
    Ok(files)
}

fn fingerprint(path: &Path, metadata: &fs::Metadata, remaining: &mut u64) -> io::Result<[u8; 32]> {
    let mut hash = Sha256::new();
    if metadata.is_symlink() {
        hash.update(b"symlink");
        hash.update(fs::read_link(path)?.as_os_str().as_encoded_bytes());
    } else if metadata.is_file() && metadata.len() <= *remaining {
        hash.update(b"file");
        let mut input = fs::File::open(path)?.take(*remaining + 1);
        let size = io::copy(&mut input, &mut hash)?;
        *remaining = remaining
            .checked_sub(size)
            .ok_or_else(|| io::Error::other("Scan limit"))?;
    } else {
        return Err(io::Error::other("Unsupported file"));
    }
    Ok(hash.finalize().into())
}
