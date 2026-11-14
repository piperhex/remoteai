use super::{package, Error, Result};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Deserialize, Serialize)]
pub(super) struct Current {
    pub enabled: bool,
    pub md5: String,
}

pub(super) struct Cache {
    pub base: String,
    directory: PathBuf,
}

impl Cache {
    #[cfg(test)]
    pub fn fixture(base: String, directory: PathBuf) -> Self {
        Self { base, directory }
    }

    pub fn for_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        let settings = crate::storage::read_app_settings(app).map_err(|_| Error::Cache)?;
        let base = settings
            .cloud_base_url
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(crate::models::DEFAULT_CLOUD_BASE_URL)
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let url = url::Url::parse(&base).map_err(|_| Error::Invalid)?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(Error::Invalid);
        }
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|_| Error::Cache)?
            .join("browser-home")
            .join(package::digest(base.as_bytes()));
        std::fs::create_dir_all(&directory).map_err(|_| Error::Cache)?;
        Ok(Self { base, directory })
    }

    pub fn current(&self) -> Result<Option<Current>> {
        match std::fs::read(self.directory.join("current.json")) {
            Ok(data) => serde_json::from_slice(&data)
                .map(Some)
                .map_err(|_| Error::Cache),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(Error::Cache),
        }
    }

    pub fn read(&self, md5: &str) -> Result<package::Home> {
        if !package::valid_digest(md5) {
            return Err(Error::Invalid);
        }
        let file = std::fs::File::open(self.directory.join(format!("{md5}.json")))
            .map_err(|_| Error::Cache)?;
        package::decode(&package::read_limited(file)?, md5)
    }

    pub fn save(&self, md5: &str, bytes: &[u8]) -> Result<()> {
        if !package::valid_digest(md5) {
            return Err(Error::Invalid);
        }
        self.write(&format!("{md5}.json"), bytes)
    }

    pub fn activate(&self, md5: &str) -> Result<()> {
        let bytes = serde_json::to_vec(&Current {
            enabled: true,
            md5: md5.to_owned(),
        })
        .map_err(|_| Error::Cache)?;
        self.write("current.json", &bytes)
    }

    pub fn disable(&self) -> Result<()> {
        if let Some(mut current) = self.current()? {
            current.enabled = false;
            self.write(
                "current.json",
                &serde_json::to_vec(&current).map_err(|_| Error::Cache)?,
            )?;
        }
        Ok(())
    }

    fn write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mut temporary =
            tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| Error::Cache)?;
        temporary.write_all(bytes).map_err(|_| Error::Cache)?;
        temporary.as_file().sync_all().map_err(|_| Error::Cache)?;
        temporary
            .persist(self.directory.join(name))
            .map_err(|_| Error::Cache)?;
        Ok(())
    }
}
