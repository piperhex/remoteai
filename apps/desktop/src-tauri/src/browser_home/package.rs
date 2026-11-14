use super::{Error, Result};
use base64::Engine;
use md5::{Digest, Md5};
use serde::Deserialize;
use std::{collections::HashMap, io::Read};

const MAX_PACKAGE_BYTES: u64 = 160 * 1024 * 1024;
const MAX_ASSET_BYTES: usize = 120 * 1024 * 1024;

#[derive(Deserialize)]
struct Bundle {
    revision: String,
    files: Vec<Asset>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    path: String,
    content_type: String,
    data: String,
}

pub(super) struct Home {
    pub revision: String,
    pub files: HashMap<String, (String, Vec<u8>)>,
}

pub(super) fn valid_digest(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Md5::digest(bytes))
}

pub(super) fn read_limited(reader: impl Read) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_PACKAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Unavailable)?;
    if bytes.len() as u64 > MAX_PACKAGE_BYTES {
        return Err(Error::Invalid);
    }
    Ok(bytes)
}

pub(super) fn safe_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && !value
            .chars()
            .any(|c| c.is_control() || "\\:%?#\"'<>`".contains(c))
}

pub(super) fn decode(bytes: &[u8], md5: &str) -> Result<Home> {
    if !valid_digest(md5) || bytes.len() as u64 > MAX_PACKAGE_BYTES || digest(bytes) != md5 {
        return Err(Error::Invalid);
    }
    let bundle: Bundle = serde_json::from_slice(bytes).map_err(|_| Error::Invalid)?;
    if uuid::Uuid::parse_str(&bundle.revision).is_err()
        || bundle.files.is_empty()
        || bundle.files.len() > 2000
    {
        return Err(Error::Invalid);
    }
    let mut files = HashMap::new();
    let mut size = 0usize;
    for file in bundle.files {
        if !safe_path(&file.path)
            || file.content_type.contains(['\r', '\n'])
            || files.contains_key(&file.path)
        {
            return Err(Error::Invalid);
        }
        let data = base64::engine::general_purpose::STANDARD
            .decode(file.data)
            .map_err(|_| Error::Invalid)?;
        size = size.checked_add(data.len()).ok_or(Error::Invalid)?;
        if size > MAX_ASSET_BYTES {
            return Err(Error::Invalid);
        }
        files.insert(file.path, (file.content_type, data));
    }
    if !files.contains_key("index.html") {
        return Err(Error::Invalid);
    }
    Ok(Home {
        revision: bundle.revision,
        files,
    })
}
