use super::{Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

/// Catalog identity is retained with the installed extension, including on remote computers.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Source {
    pub id: String,
    pub sha256: String,
}

impl Source {
    pub(super) fn verify(&self, path: &Path) -> Result<()> {
        uuid::Uuid::parse_str(&self.id).map_err(|_| Error::Invalid)?;
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(Error::Invalid);
        }
        let mut file = fs::File::open(path).map_err(|_| Error::Invalid)?;
        if file.metadata().map_err(|_| Error::Invalid)?.len() > 64 * 1024 * 1024 {
            return Err(Error::Invalid);
        }
        let mut digest = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let size = file.read(&mut buffer).map_err(|_| Error::Invalid)?;
            if size == 0 {
                break;
            }
            digest.update(&buffer[..size]);
        }
        if format!("{:x}", digest.finalize()) != self.sha256 {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

pub(super) struct Installation<'a> {
    pub path: &'a str,
    pub market: Option<Source>,
}
