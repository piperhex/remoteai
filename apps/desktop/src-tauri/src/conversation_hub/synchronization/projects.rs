//! Read project membership from the selected source home without changing rollout directories.
use super::super::{browse_codex_threads_blocking, ThreadContext, ThreadEntry};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::Path,
};
use tauri::Runtime;

const GLOBAL_STATE: &str = ".codex-global-state.json";
const MAX_STATE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
enum MetadataError {
    #[error("project metadata could not be read: {0}")]
    Io(#[from] std::io::Error),
    #[error("project metadata could not be parsed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("project metadata exceeds the size limit")]
    TooLarge,
}

#[derive(Default)]
struct SourceProjects {
    projects: HashMap<String, Project>,
    assignments: HashMap<String, String>,
    projectless: HashSet<String>,
}

struct Project {
    name: String,
    roots: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncThreadEntry {
    #[serde(flatten)]
    entry: ThreadEntry,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_name: Option<String>,
}

pub(super) fn list<R: Runtime>(
    context: ThreadContext<R>,
    query: Option<String>,
) -> Result<Value, String> {
    let projects = match SourceProjects::read(&context.paths.codex_home) {
        Ok(projects) => projects,
        Err(error) => {
            // Optional UI preferences must not hide otherwise readable conversations.
            crate::error_logs::record_codex_error(&format!(
                "Conversation sync project metadata: {error}"
            ));
            SourceProjects::default()
        }
    };
    let entries = browse_codex_threads_blocking(context, query.clone(), query)?;
    serde_json::to_value(
        entries
            .into_iter()
            .map(|entry| projects.describe(entry))
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())
}

impl SourceProjects {
    fn read(home: &Path) -> Result<Self, MetadataError> {
        let file = match File::open(home.join(GLOBAL_STATE)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(error) => return Err(error.into()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_STATE_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_STATE_BYTES {
            return Err(MetadataError::TooLarge);
        }
        Ok(Self::from_value(&serde_json::from_slice(&bytes)?))
    }

    fn from_value(value: &Value) -> Self {
        let mut result = Self::default();
        if let Some(ids) = value
            .get("projectless-thread-ids")
            .and_then(Value::as_array)
        {
            result
                .projectless
                .extend(ids.iter().filter_map(Value::as_str).map(str::to_owned));
        }
        if let Some(outputs) = value
            .get("thread-projectless-output-directories")
            .and_then(Value::as_object)
        {
            result.projectless.extend(outputs.keys().cloned());
        }
        result.read_projects(value);
        if let Some(assignments) = value
            .get("thread-project-assignments")
            .and_then(Value::as_object)
        {
            for (id, assignment) in assignments {
                if assignment.get("projectKind").and_then(Value::as_str) != Some("local") {
                    continue;
                }
                if let Some(project) = assignment.get("projectId").and_then(Value::as_str) {
                    result.assignments.insert(id.clone(), project.to_owned());
                }
            }
        }
        result
    }

    fn read_projects(&mut self, value: &Value) {
        if let Some(projects) = value.get("local-projects").and_then(Value::as_object) {
            for (id, project) in projects {
                let roots = project
                    .get("rootPaths")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(|root| !root.trim().is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                if roots.is_empty() {
                    continue;
                }
                let name = project
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                self.projects.insert(id.clone(), Project { name, roots });
            }
        }
        if let Some(labels) = value
            .get("electron-workspace-root-labels")
            .and_then(Value::as_object)
        {
            for (path, label) in labels {
                if let Some(name) = label.as_str().filter(|name| !name.trim().is_empty()) {
                    self.projects
                        .entry(path.clone())
                        .or_insert_with(|| Project {
                            name: name.trim().to_owned(),
                            roots: vec![path.clone()],
                        });
                }
            }
        }
    }

    fn describe(&self, entry: ThreadEntry) -> SyncThreadEntry {
        if self.projectless.contains(&entry.session_id) {
            return SyncThreadEntry {
                entry,
                project_path: Some(String::new()),
                project_name: None,
            };
        }
        let cwd = path_key(&entry.cwd);
        let assigned = self
            .assignments
            .get(&entry.session_id)
            .and_then(|id| self.projects.get(id));
        let matching = || {
            self.projects
                .values()
                .filter_map(|project| {
                    project
                        .roots
                        .iter()
                        .map(|root| path_key(root))
                        .filter(|root| contains_path(root, &cwd))
                        .map(|root| (root.len(), project))
                        .max_by_key(|(length, _)| *length)
                })
                .max_by_key(|(length, _)| *length)
                .map(|(_, project)| project)
        };
        let project = assigned.or_else(matching);
        SyncThreadEntry {
            project_path: project.and_then(|project| project.roots.first()).cloned(),
            project_name: project
                .map(|project| project.name.clone())
                .filter(|name| !name.is_empty()),
            entry,
        }
    }
}

fn path_key(path: &str) -> String {
    let path = path.trim().replace('\\', "/");
    let path = path.strip_prefix("//?/").unwrap_or(&path);
    let path = if path
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("UNC/"))
    {
        format!("//{}", &path[4..])
    } else {
        path.to_owned()
    };
    let windows = path.as_bytes().get(1) == Some(&b':') || path.starts_with("//");
    let trimmed = path.trim_end_matches('/');
    let normalized = if !path.is_empty() && trimmed.is_empty() {
        "/"
    } else {
        trimmed
    };
    if windows {
        normalized.to_lowercase()
    } else {
        normalized.to_owned()
    }
}

fn contains_path(root: &str, path: &str) -> bool {
    !root.is_empty()
        && (path == root
            || path
                .strip_prefix(root)
                .is_some_and(|suffix| suffix.starts_with('/')))
}

#[cfg(test)]
#[path = "projects_tests.rs"]
mod tests;
