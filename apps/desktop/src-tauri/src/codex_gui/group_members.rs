//! Read only the requested page of grouping metadata, without loading conversation bodies.
mod query;
mod storage;
pub(super) mod summaries;
#[cfg(test)]
mod tests;

use super::{
    error::{GuiError, Result},
    protocol::GuiResponse,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

const PAGE_SIZES: [u32; 3] = [20, 50, 100];
const MAX_PAGE: u32 = 1_000_000;
const MAX_SEARCH_BYTES: usize = 4_000;
const MAX_PREFERENCES: usize = 100_000;
const MAX_LABEL_BYTES: usize = 16_384;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Query {
    page: u32,
    page_size: u32,
    search: String,
    projects: Vec<Project>,
    project_overrides: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct Project {
    path: String,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    data: Vec<Member>,
    total: u64,
    page: u32,
    page_size: u32,
}

#[derive(Debug, Serialize)]
struct Member {
    kind: Kind,
    id: String,
    title: String,
    cwd: String,
    archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Project,
    Thread,
}

impl Query {
    fn validate(&self) -> Result<()> {
        let invalid_label = |value: &str| value.len() > MAX_LABEL_BYTES || value.contains('\0');
        if self.page == 0
            || self.page > MAX_PAGE
            || !PAGE_SIZES.contains(&self.page_size)
            || self.search.len() > MAX_SEARCH_BYTES
            || self.projects.len() > MAX_PREFERENCES
            || self.project_overrides.len() > MAX_PREFERENCES
            || self
                .projects
                .iter()
                .any(|p| invalid_label(&p.path) || invalid_label(&p.name))
            || self
                .project_overrides
                .iter()
                .any(|(id, path)| invalid_label(id) || invalid_label(path))
        {
            return Err(GuiError::InvalidRequest);
        }
        Ok(())
    }
}

pub(super) async fn load(home: PathBuf, root: PathBuf, query: Query) -> Result<GuiResponse> {
    query.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        let page = read(&home, &root, &query).map_err(|_| GuiError::GroupMembers)?;
        Ok(GuiResponse {
            data: serde_json::to_value(page).map_err(|_| GuiError::GroupMembers)?,
        })
    })
    .await
    .map_err(|_| GuiError::GroupMembers)?
}

fn read(home: &Path, root: &Path, query: &Query) -> rusqlite::Result<Page> {
    let mut connection = storage::open(home)?;
    storage::functions(&connection, root)?;
    let transaction = connection.transaction()?;
    storage::preferences(&transaction, query)?;
    let sql = query::members(&transaction)?;
    storage::legacy_names(&transaction, home)?;
    let search = query.search.trim().to_lowercase();
    let total: u64 = transaction.query_row(
        &format!("{sql} SELECT COUNT(*) FROM matches"),
        [&search],
        |row| row.get(0),
    )?;
    let last_page = total.saturating_sub(1) / u64::from(query.page_size) + 1;
    let page = u64::from(query.page).min(last_page) as u32;
    let data = query::page(&transaction, &sql, &search, (page, query.page_size))?;
    // The main connection is read-only. Only temporary preference/name tables were written.
    transaction.commit()?;
    Ok(Page {
        data,
        total,
        page,
        page_size: query.page_size,
    })
}
