//! Persist the first v2 startup even while signed out or when an upload fails.

use super::UsageError;
use crate::storage::write_json_atomic;
use std::{fs, io, path::Path};
use tauri::{Manager, Runtime};

const START_FILENAME: &str = "official-usage-v2-start.json";

pub(super) fn started_at<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<i64, UsageError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| UsageError::Unavailable)?
        .join(START_FILENAME);
    read_or_start(&path, chrono::Utc::now().timestamp())
}

fn read_or_start(path: &Path, now: i64) -> Result<i64, UsageError> {
    match fs::read(path) {
        Ok(bytes) => {
            let start: i64 = serde_json::from_slice(&bytes).map_err(|_| UsageError::Unavailable)?;
            if start < 0 {
                return Err(UsageError::Unavailable);
            }
            Ok(start)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            write_json_atomic(path, &serde_json::json!(now))
                .map_err(|_| UsageError::Unavailable)?;
            Ok(now)
        }
        Err(_) => Err(UsageError::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracking_start_survives_restarts_without_reading_legacy_checkpoints() {
        let root =
            std::env::temp_dir().join(format!("official-usage-start-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("official-usage-report-old.json"), "{}").unwrap();
        let path = root.join(START_FILENAME);
        assert_eq!(read_or_start(&path, 200).unwrap(), 200);
        assert_eq!(read_or_start(&path, 300).unwrap(), 200);
        fs::write(&path, "invalid").unwrap();
        assert!(read_or_start(&path, 400).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
