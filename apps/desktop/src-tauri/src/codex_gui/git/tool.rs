//! Remote repository tools share the desktop mutation guard and run entirely off the UI thread.
use super::{directory, repository, GitError, GitState, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[cfg(test)]
mod action_tests;
mod actions;
mod branches;
mod changes;
mod commit;
mod commit_files;
#[cfg(test)]
mod commit_files_tests;
#[cfg(test)]
mod conflict_tests;
mod conflicts;
mod file_actions;
#[cfg(test)]
mod file_actions_tests;
mod file_activity;
#[cfg(test)]
mod file_activity_tests;
mod history;
mod integration;
mod message;
mod message_context;
#[cfg(test)]
mod message_tests;
mod message_transport;
pub(crate) mod patch;
#[cfg(test)]
mod patch_tests;
pub(super) mod repositories;
#[cfg(test)]
mod repository_tests;
mod review;
mod revision;
#[cfg(test)]
mod revision_tests;
mod settings;
#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Request {
    Settings {
        auto_message: Option<bool>,
    },
    GenerateMessage {
        #[serde(flatten)]
        request: message::Request,
    },
    Review {
        cwd: String,
        #[serde(flatten)]
        request: review::Action,
    },
    Repository {
        cwd: String,
        #[serde(default)]
        include_children: bool,
    },
    Action {
        cwd: String,
        #[serde(flatten)]
        request: actions::ActionRequest,
    },
    Revision {
        cwd: String,
        #[serde(flatten)]
        request: revision::Request,
    },
    Changes {
        cwd: String,
    },
    Diff {
        cwd: String,
        path: String,
        commit: Option<String>,
    },
    History {
        cwd: String,
        skip: usize,
    },
    CommitFiles {
        cwd: String,
        commit: String,
    },
    Commit {
        cwd: String,
        head: Option<String>,
        message: String,
        files: Vec<SelectedFile>,
    },
    FileAction {
        cwd: String,
        head: Option<String>,
        action: file_actions::Action,
        files: Vec<SelectedFile>,
    },
    Conflict {
        cwd: String,
        path: String,
    },
    ResolveConflict {
        cwd: String,
        #[serde(flatten)]
        request: conflicts::Resolution,
    },
    ContinueIntegration {
        cwd: String,
        version: String,
    },
}

#[derive(Deserialize)]
pub(crate) struct SelectedFile {
    path: String,
    version: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum Response {
    Settings(settings::Settings),
    Message { message: String },
    Review(review::Response),
    Repository(branches::Repository),
    Done(()),
    Changes(changes::Changes),
    Diff(history::Diff),
    History(history::History),
    CommitFiles(Vec<commit_files::CommitFile>),
    Commit { hash: String },
    Conflict(conflicts::Conflict),
}

fn execute(request: Request) -> Result<Response> {
    let cwd = match &request {
        Request::Settings { .. } => return Err(GitError::Operation),
        Request::GenerateMessage { request } => &request.cwd,
        Request::Review { cwd, .. }
        | Request::Changes { cwd }
        | Request::Repository { cwd, .. }
        | Request::Action { cwd, .. }
        | Request::Revision { cwd, .. }
        | Request::Diff { cwd, .. }
        | Request::History { cwd, .. }
        | Request::CommitFiles { cwd, .. }
        | Request::Commit { cwd, .. }
        | Request::Conflict { cwd, .. }
        | Request::ResolveConflict { cwd, .. }
        | Request::ContinueIntegration { cwd, .. }
        | Request::FileAction { cwd, .. } => cwd,
    };
    let root = repository(&directory(cwd)?)?;
    match request {
        Request::Review { .. } | Request::GenerateMessage { .. } | Request::Settings { .. } => {
            Err(GitError::Operation)
        }
        Request::Repository {
            include_children, ..
        } => {
            let mut value = branches::read(&root)?;
            if include_children {
                value.repositories = Some(repositories::read(&root)?);
            }
            Ok(Response::Repository(value))
        }
        Request::Conflict { path, .. } => conflicts::read(&root, &path).map(Response::Conflict),
        Request::ResolveConflict { request, .. } => {
            conflicts::resolve(&root, request).map(Response::Done)
        }
        Request::ContinueIntegration { version, .. } => {
            integration::resume(&root, &version).map(Response::Done)
        }
        Request::Action { request, .. } => actions::execute(&root, &request).map(Response::Done),
        Request::Revision { request, .. } => revision::execute(&root, &request).map(Response::Done),
        Request::Changes { .. } => changes::read(&root).map(Response::Changes),
        Request::Diff { path, commit, .. } => {
            history::diff(&root, &path, commit.as_deref()).map(Response::Diff)
        }
        Request::History { skip, .. } => history::read(&root, skip).map(Response::History),
        Request::CommitFiles { commit, .. } => {
            commit_files::read(&root, &commit).map(Response::CommitFiles)
        }
        Request::Commit {
            head,
            message,
            files,
            ..
        } => commit::create(&root, head.as_deref(), &message, &files)
            .map(|hash| Response::Commit { hash }),
        Request::FileAction {
            head,
            action,
            files,
            ..
        } => file_actions::execute(&root, head.as_deref(), action, &files).map(Response::Done),
    }
}

pub(super) fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.contains(['\0', '\\'])
        || Path::new(path).is_absolute()
        || path.split('/').any(|part| {
            part.is_empty()
                || part == ".."
                || part == "."
                || part.eq_ignore_ascii_case(".git")
                || part.contains(':')
        })
    {
        return Err(GitError::File);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_git_tool(
    app: AppHandle,
    state: State<'_, GitState>,
    request: Request,
) -> std::result::Result<Response, String> {
    if let Request::GenerateMessage { request } = request {
        return message::generate(app, state.0.clone(), request)
            .await
            .map(|message| Response::Message { message })
            .map_err(|error| error.to_string());
    }
    let workspace = match &request {
        Request::Action { cwd, request } if request.changes_worktree() => {
            Some(super::workspace_change(&app, cwd.clone()).await?)
        }
        Request::Revision { cwd, .. }
        | Request::ResolveConflict { cwd, .. }
        | Request::ContinueIntegration { cwd, .. } => {
            Some(super::workspace_change(&app, cwd.clone()).await?)
        }
        _ => None,
    };
    let guard = state.0.clone();
    let activity = app.state::<crate::codex_gui::GuiState>().workspaces.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _workspace = workspace;
        // GitHub requests do not mutate local files and must not block unrelated Git tools during network waits.
        let needs_guard = !matches!(
            &request,
            Request::Review {
                request: review::Action::PullRequest | review::Action::CreatePullRequest { .. },
                ..
            }
        );
        let _guard = if needs_guard {
            Some(guard.lock().map_err(|_| GitError::Operation)?)
        } else {
            None
        };
        let _files = file_activity::reserve(&request, &activity)?;
        match request {
            Request::Settings { auto_message } => {
                let data = app.path().app_data_dir().map_err(|_| GitError::Settings)?;
                settings::access(&data, auto_message).map(Response::Settings)
            }
            Request::Review { cwd, request } => {
                let data = app
                    .path()
                    .app_data_dir()
                    .map_err(|_| GitError::ReviewStorage)?;
                review::execute(&cwd, &data, request).map(Response::Review)
            }
            request => execute(request),
        }
    })
    .await
    .map_err(|_| GitError::Operation.to_string())?
    .map_err(|error| error.to_string())
}
