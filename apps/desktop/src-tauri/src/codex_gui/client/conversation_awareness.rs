use futures_util::future::join_all;
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use super::Client;
use crate::codex_gui::{
    conversation_context as context,
    error::{GuiError, Result},
    workspaces,
};

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_RUNNING_PAGE: usize = 50;

impl Client {
    /// Make host-driven sends visible to connected GUIs without changing their selected conversation.
    pub(in crate::codex_gui) async fn publish_tool_conversation(&self, response: &Value) {
        let Some(thread) = response.get("thread") else {
            return;
        };
        let mut params = json!({"thread":thread});
        workspaces::hide_project_paths(&mut params, &self.projectless_root);
        self.emit(super::GuiEvent {
            method: "thread/resumed".into(),
            params,
            id: None,
        })
        .await;
    }

    pub(super) async fn prepare_conversation_context(&self, params: &mut Value) -> Result<()> {
        let references = context::references(params)?;
        let count = references.len();
        // Read each source without resuming it or changing its running turn.
        let snapshots = join_all(references.iter().map(|id| async move {
            let thread = self
                .context_thread(id, true)
                .await
                .map_err(|_| GuiError::ConversationReference)?;
            context::reference(&thread, count)
        }))
        .await
        .into_iter()
        .collect::<Result<Vec<_>>>()?;
        context::append(params, snapshots)
    }

    /// Read activity only when requested; ordinary messages perform no running-thread lookups.
    pub(in crate::codex_gui) async fn running_conversations(
        &self,
        cursor: Option<String>,
    ) -> Result<Value> {
        let queried_at = chrono::Utc::now().to_rfc3339();
        let mut active: Vec<_> = self
            .active_turns
            .lock()
            .await
            .iter()
            .map(|(id, turn)| (id.clone(), turn.clone()))
            .collect();
        active.sort_by(|left, right| left.0.cmp(&right.0));
        let total = active.len();
        active.retain(|(id, _)| cursor.as_ref().is_none_or(|cursor| id > cursor));
        let more = active.len() > MAX_RUNNING_PAGE;
        active.truncate(MAX_RUNNING_PAGE);
        let next = more
            .then(|| active.last().map(|(id, _)| id.clone()))
            .flatten();
        let running = join_all(active.iter().map(|(id, turn)| async move {
            // A just-created running thread may not have persisted history yet; its ID remains useful.
            let thread = self.context_thread(id, false).await.unwrap_or(Value::Null);
            let mut summary = context::summary(id, &thread);
            summary["threadId"] = json!(id);
            summary["turnId"] = json!(turn);
            summary
        }))
        .await;
        Ok(
            json!({"conversations": running, "total":total, "nextCursor":next,
            "queriedAt":queried_at}),
        )
    }

    async fn context_thread(&self, id: &str, include_turns: bool) -> Result<Value> {
        let mut response = timeout(
            SNAPSHOT_TIMEOUT,
            self.request_raw(
                "thread/read",
                json!({"threadId": id, "includeTurns": include_turns}),
            ),
        )
        .await
        .map_err(|_| GuiError::Timeout)??;
        workspaces::hide_project_paths(&mut response, &self.projectless_root);
        if response["thread"]["id"] != id {
            return Err(GuiError::ConversationReference);
        }
        Ok(response["thread"].take())
    }
}
