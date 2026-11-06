//! Reclaim only the temporary tabs explicitly recorded by this task.
use std::{collections::HashSet, future::Future};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::{protocol::identifier, registry::MAX_TABS, Error, Result, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Finish {
    pub thread_id: String,
    tab_ids: Vec<String>,
    #[serde(default)]
    keep_tab_ids: Vec<String>,
}

impl Finish {
    fn validate(&self) -> Result<()> {
        if !identifier(&self.thread_id)
            || self.tab_ids.len() > MAX_TABS
            || self.keep_tab_ids.len() > MAX_TABS
            || self
                .tab_ids
                .iter()
                .any(|id| uuid::Uuid::parse_str(id).is_err())
            || self
                .keep_tab_ids
                .iter()
                .any(|id| !self.tab_ids.contains(id))
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinishReply {
    closed_tab_ids: Vec<String>,
    kept_tab_ids: Vec<String>,
    failed_tab_ids: Vec<String>,
}

enum Outcome {
    Closed,
    Kept,
}

pub(crate) async fn execute(app: AppHandle, request: Finish) -> Result<FinishReply> {
    let thread = request.thread_id.clone();
    finish_with(request, move |id, keep| {
        let (app, thread) = (app.clone(), thread.clone());
        async move { finish_tab(&app, &thread, &id, keep).await }
    })
    .await
}

async fn finish_with<F, Operation>(request: Finish, mut operation: Operation) -> Result<FinishReply>
where
    F: Future<Output = Result<Outcome>>,
    Operation: FnMut(String, bool) -> F,
{
    request.validate()?;
    let mut reply = FinishReply::default();
    let mut visited = HashSet::new();
    for id in request.tab_ids {
        if !visited.insert(id.clone()) {
            continue;
        }
        let keep = request.keep_tab_ids.contains(&id);
        match operation(id.clone(), keep).await {
            Ok(Outcome::Closed) => reply.closed_tab_ids.push(id),
            Ok(Outcome::Kept) => reply.kept_tab_ids.push(id),
            Err(_) => reply.failed_tab_ids.push(id),
        }
    }
    Ok(reply)
}

async fn finish_tab(app: &AppHandle, thread: &str, id: &str, keep: bool) -> Result<Outcome> {
    let Some(tab) = app.state::<State>().find(thread, id)? else {
        return Ok(Outcome::Closed);
    };
    let _operation = tab.operation.lock().await;
    if keep {
        return Ok(Outcome::Kept);
    }
    super::close(app, &tab).await?;
    Ok(Outcome::Closed)
}

#[cfg(test)]
mod tests;
