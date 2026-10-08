use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

pub(super) const MAX_ENTRIES: i64 = 5_000;
const DEFAULT_PAGE_SIZE: u32 = 100;
const MAX_PAGE_SIZE: u32 = 200;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ErrorLogSource {
    Proxy,
    Toast,
    Codex,
}

impl ErrorLogSource {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Proxy => "proxy",
            Self::Toast => "toast",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorLogEntry {
    pub(crate) id: i64,
    pub(crate) created_at: String,
    pub(crate) source: ErrorLogSource,
    pub(crate) message: String,
    pub(crate) status_code: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorLogPage {
    pub(crate) entries: Vec<ErrorLogEntry>,
    pub(crate) has_more: bool,
    pub(crate) total: u32,
    pub(crate) page: u32,
    pub(crate) snapshot_id: Option<i64>,
}

/// Numbered pages remain anchored while newer records arrive.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ErrorLogPagination {
    pub(crate) page: u32,
    pub(crate) snapshot_id: Option<i64>,
}

pub(super) struct NewEntry {
    pub(super) created_at: String,
    pub(super) source: ErrorLogSource,
    pub(super) message: String,
    pub(super) status_code: Option<u16>,
}

#[derive(Clone, Copy)]
pub(super) struct ListQuery {
    pub(super) limit: u32,
    pub(super) before_id: Option<i64>,
    pub(super) source: Option<ErrorLogSource>,
    pub(super) offset: u32,
    pub(super) snapshot_id: Option<i64>,
}

impl ListQuery {
    pub(super) fn new(
        limit: Option<u32>,
        before_id: Option<i64>,
        source: Option<ErrorLogSource>,
    ) -> Result<Self, LogError> {
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
        if limit == 0 || limit > MAX_PAGE_SIZE || before_id.is_some_and(|id| id <= 0) {
            return Err(LogError::InvalidQuery);
        }
        Ok(Self {
            limit,
            before_id,
            source,
            offset: 0,
            snapshot_id: None,
        })
    }

    pub(super) fn with_pagination(
        mut self,
        pagination: Option<ErrorLogPagination>,
    ) -> Result<Self, LogError> {
        let Some(pagination) = pagination else {
            return Ok(self);
        };
        if self.before_id.is_some()
            || pagination.page == 0
            || pagination.page > MAX_ENTRIES as u32
            || pagination.snapshot_id.is_some_and(|id| id <= 0)
        {
            return Err(LogError::InvalidQuery);
        }
        self.offset = (pagination.page - 1) * self.limit;
        self.snapshot_id = pagination.snapshot_id;
        Ok(self)
    }
}

#[derive(Debug)]
pub(super) enum LogError {
    Database(rusqlite::Error),
    FileSystem(std::io::Error),
    Unavailable,
    InvalidQuery,
}

impl fmt::Display for LogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidQuery => "日志查询条件无效，请刷新后重试。",
            _ => "暂时无法访问错误日志，请稍后重试。",
        };
        formatter.write_str(message)
    }
}

impl Error for LogError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            Self::FileSystem(error) => Some(error),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for LogError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<std::io::Error> for LogError {
    fn from(error: std::io::Error) -> Self {
        Self::FileSystem(error)
    }
}
