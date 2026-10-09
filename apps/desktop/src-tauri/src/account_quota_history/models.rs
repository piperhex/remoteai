use std::{error::Error, fmt, io};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountQuotaHistory {
    pub(crate) account_id: String,
    pub(crate) account_label: String,
    pub(crate) points: Vec<AccountQuotaPoint>,
}

/// Actual sampled levels, with the preceding observation included for range deltas.
/// Reset timestamps allow callers to avoid counting replenished quota as consumption.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountQuotaPoint {
    pub(crate) ts: i64,
    pub(crate) primary_remaining_percent: Option<f64>,
    pub(crate) secondary_remaining_percent: Option<f64>,
    pub(crate) primary_reset_at: Option<i64>,
    pub(crate) secondary_reset_at: Option<i64>,
}

#[derive(Clone, Copy)]
pub(super) struct HistoryRange {
    pub(super) start: i64,
    pub(super) end: i64,
}

impl HistoryRange {
    pub(super) fn new(start: i64, end: i64) -> Result<Self, HistoryError> {
        if start < 0 || end < start {
            return Err(HistoryError::InvalidRange);
        }
        Ok(Self { start, end })
    }
}

#[derive(Debug)]
pub(crate) enum HistoryError {
    InvalidRange,
    StorageUnavailable,
    LockUnavailable,
    Io(io::Error),
    Database(rusqlite::Error),
}

impl fmt::Display for HistoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRange => "请选择有效的统计时间范围。",
            Self::StorageUnavailable | Self::LockUnavailable | Self::Io(_) | Self::Database(_) => {
                "暂时无法读取或保存账户额度记录，请重试。"
            }
        })
    }
}

impl Error for HistoryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for HistoryError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for HistoryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}
