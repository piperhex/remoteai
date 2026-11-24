//! Keep large immutable review bodies on the execution host. History carries their result,
//! and a viewer can page through the saved files without consulting the current workspace.
use super::super::{
    error::{GuiError, Result},
    protocol::GuiResponse,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const INLINE_BYTES: usize = 128 * 1024;
const BODY_BYTES: usize = 128 * 1024;
const PAGE: usize = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    thread_id: String,
    turn_id: String,
    file: Option<usize>,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    activity: bool,
}

fn edits(turn: &Value) -> impl Iterator<Item = (&Value, &Value)> {
    turn["reviewEdits"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(move |change| (item, change))
        })
}

pub(super) fn project(turn: &mut Value) {
    let diff = turn["diff"].as_str();
    let size = edits(turn)
        .map(|(_, edit)| edit["diff"].as_str().map_or(0, str::len))
        .sum::<usize>();
    if turn["status"] == "inProgress"
        || size.saturating_add(diff.map_or(0, str::len)) <= INLINE_BYTES
    {
        return;
    }
    let result = match (turn["reviewIncomplete"] == true, diff) {
        (true, _) => "incomplete",
        (_, Some(text)) if text.trim().is_empty() => "empty",
        (_, Some(_)) => "net",
        _ if edits(turn).any(|(item, _)| item["status"] == "completed") => "tools",
        _ => "incomplete",
    };
    let recorded: HashSet<String> = edits(turn)
        .filter_map(|(item, _)| item["id"].as_str().map(str::to_owned))
        .collect();
    turn["reviewHasEdits"] = json!(
        matches!(result, "net" | "tools")
            && edits(turn).any(|(item, _)| item["status"] == "completed")
    );
    turn["reviewDeferred"] = json!(result);
    turn["diff"] = Value::Null;
    turn["reviewEdits"] = json!([]);
    for item in turn
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        omit_edit_body(item, &recorded);
        for output in item
            .get_mut("processOutputs")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            omit_edit_body(output, &recorded);
        }
    }
}

fn omit_edit_body(item: &mut Value, recorded: &HashSet<String>) {
    if item["type"] == "fileChange" && item["id"].as_str().is_some_and(|id| recorded.contains(id)) {
        for change in item["changes"].as_array_mut().into_iter().flatten() {
            change["diff"] = json!("");
        }
    }
}

struct File<'a> {
    meta: Value,
    text: &'a str,
}

fn patch_files(diff: &str) -> impl Iterator<Item = File<'_>> {
    let git = diff.starts_with("diff --git ") || diff.contains("\ndiff --git ");
    let separator = if git { "\ndiff --git " } else { "\n--- " };
    let positions = move || {
        diff.match_indices(separator)
            .map(|(index, _)| index + 1)
            .filter(move |&index| {
                git || diff[index..]
                    .split_once('\n')
                    .is_some_and(|(_, tail)| tail.starts_with("+++ "))
            })
    };
    std::iter::once(0)
        .chain(positions())
        .zip(positions().chain(std::iter::once(diff.len())))
        .map(|(start, end)| {
            let text = &diff[start..end];
            let end = text.floor_char_boundary(text.len().min(16 * 1024));
            let header = text[..end]
                .lines()
                .take_while(|line| !line.starts_with("@@"))
                .take(12)
                .collect::<Vec<_>>()
                .join("\n");
            File {
                meta: json!({"header":header}),
                text,
            }
        })
}

fn body(text: &str, offset: usize) -> Result<Value> {
    if !text.is_char_boundary(offset) {
        return Err(GuiError::InvalidRequest);
    }
    let mut end = offset.saturating_add(BODY_BYTES).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Ok(json!({"text": &text[offset..end], "next": (end < text.len()).then_some(end)}))
}

fn page<'a>(mut files: impl Iterator<Item = File<'a>>, target: &Target) -> Result<Value> {
    if let Some(index) = target.file {
        return body(
            files.nth(index).ok_or(GuiError::InvalidRequest)?.text,
            target.offset,
        );
    }
    let mut files = files.skip(target.offset).peekable();
    let rows: Vec<_> = files.by_ref().take(PAGE).map(|file| file.meta).collect();
    let next = files.peek().map(|_| target.offset + rows.len());
    Ok(json!({"files": rows, "next": next}))
}

pub(super) fn saved(home: &Path, target: &Target) -> Result<Value> {
    let mut history =
        json!({"id":target.thread_id,"turns":[{"id":target.turn_id,"status":"completed"}]});
    super::restore(home, &mut history).map_err(|_| GuiError::FileRead)?;
    let turn = &history["turns"][0];
    if !turn["reviewEdits"].is_array() {
        return Err(GuiError::FileRead);
    }
    if !target.activity {
        if let Some(diff) = turn["diff"].as_str() {
            return page(
                patch_files(diff).filter(|file| !file.text.is_empty()),
                target,
            );
        }
    }
    let files = edits(turn)
        .filter(|(item, _)| target.activity || item["status"] == "completed")
        .map(|(item, edit)| File {
            meta: json!({"path":edit["path"],"kind":edit["kind"],"item":item["id"]}),
            text: edit["diff"].as_str().unwrap_or_default(),
        });
    page(files, target)
}

pub(crate) async fn read(home: PathBuf, target: Target) -> Result<GuiResponse> {
    super::super::protocol::id(&target.thread_id)?;
    super::super::protocol::id(&target.turn_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        saved(&home, &target).map(|data| GuiResponse { data })
    })
    .await
    .map_err(|_| GuiError::FileRead)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_review_reopens_exact_saved_files_and_tool_activity_in_pages() {
        let dir = tempfile::tempdir().unwrap();
        let patch = |path: &str, text: &str| {
            format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1 @@\n+{text}\n")
        };
        let first = patch("大 文件", &"数".repeat(BODY_BYTES));
        let second = patch("B", "second");
        let db = super::super::open(dir.path()).unwrap();
        db.execute(
            "INSERT INTO turns VALUES ('thread','one','original',?1,1,1)",
            [format!("{first}{second}")],
        )
        .unwrap();
        let item = json!({"id":"edit","status":"completed","type":"fileChange",
            "changes":[{"path":"B","kind":{"type":"add"},"diff":"second"}]});
        db.execute(
            "INSERT INTO edits VALUES ('thread','one','edit',?1)",
            [item.to_string()],
        )
        .unwrap();
        drop(db);
        let mut history = json!({"id":"thread","turns":[{"id":"one","status":"completed",
            "items":[{"id":"folded","processOutputs":[{"type":"fileChange","id":"edit",
                "changes":[{"path":"B","diff":first}]}]}]}]});
        super::super::restore_page(dir.path(), &mut history).unwrap();
        assert_eq!(history["turns"][0]["reviewDeferred"], "net");
        assert_eq!(history["turns"][0]["reviewCwd"], "original");
        assert!(history.to_string().len() < 512);
        let mut target: Target =
            serde_json::from_value(json!({"threadId":"thread","turnId":"one"})).unwrap();
        let list = saved(dir.path(), &target).unwrap();
        assert_eq!(list["files"].as_array().unwrap().len(), 2);
        assert!(list.to_string().len() < 512);
        target.file = Some(0);
        let mut text = String::new();
        loop {
            let page = saved(dir.path(), &target).unwrap();
            text.push_str(page["text"].as_str().unwrap());
            let Some(next) = page["next"].as_u64() else {
                break;
            };
            target.offset = next as usize;
        }
        assert_eq!(text, first);
        target.offset = 0;
        target.file = Some(1);
        assert_eq!(saved(dir.path(), &target).unwrap()["text"], second);
        target.file = Some(0);
        target.activity = true;
        assert_eq!(saved(dir.path(), &target).unwrap()["text"], "second");
        target.thread_id = "other".into();
        assert!(saved(dir.path(), &target).is_err());
    }
}
