//! Repository operations run on a worker; discarding local edits requires an explicit file selection.
use super::platform::execution_path;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

#[cfg(test)]
#[path = "git_tests.rs"]
mod tests;
pub(crate) mod tool;

#[derive(Debug, thiserror::Error)]
pub(super) enum GitError {
    #[error("暂时无法同步 Git 设置，请稍后重试。")]
    Settings,
    #[error("未能生成提交说明，请重试或手动填写。")]
    MessageGeneration,
    #[error("请先在 Codex GUI 中选择可用的 AI 账户。")]
    MessageAccount,
    #[error("所选文件过多，请减少选择后再生成提交说明。")]
    MessageSize,
    #[error("无法保存验证记录，请检查电脑可用空间后重试。")]
    ReviewStorage,
    #[error("项目已有验证在运行，请等待完成。")]
    ReviewBusy,
    #[error("项目未配置这项验证，请先在电脑上配置。")]
    ReviewCommand,
    #[error("未跟踪文件过大或包含链接，暂时无法核实代码版本。请先在电脑上整理文件。")]
    ReviewSize,
    #[error("项目包含子模块，暂时无法完整核实验证版本，请在电脑上验证。")]
    ReviewSubmodule,
    #[error("项目有跳过检查的文件，暂时无法核实代码版本。请先在电脑上恢复这些文件的正常跟踪。")]
    ReviewHiddenFiles,
    #[error("代码已变化，请刷新验收结果后再试。")]
    ReviewChanged,
    #[error("请先通过 Git 入口提交并推送当前改动，再创建 PR。")]
    ReviewDirty,
    #[error("无法读取 GitHub 状态，请在电脑上安装并登录 GitHub CLI，再检查网络和仓库权限。")]
    ReviewGithub,
    #[error("请填写 PR 标题，并缩短过长的说明。")]
    ReviewPrInput,
    #[error("PR 创建结果尚未确认，请刷新 PR 状态；若未创建，请检查分支是否已推送。")]
    ReviewPrUnknown,
    #[error("无法读取项目，请确认文件夹仍然存在。")]
    Directory,
    #[error("无法运行 Git，请确认已安装 Git。")]
    Unavailable,
    #[error("这个文件夹不是 Git 仓库。")]
    Repository,
    #[error("分支名称无效，请换一个名称。")]
    Branch,
    #[error("无法切换分支。请检查未提交的修改，或确认分支未被其他工作树使用。")]
    Checkout,
    #[error("无法检出此提交，请先保存未提交的改动后重试。")]
    RevisionCheckout,
    #[error("重置未完成，请检查未提交的改动或正在进行的 Git 操作。")]
    Reset,
    #[error("当前不在任何分支上，请先切换到要重置的分支。")]
    DetachedReset,
    #[error("项目已变化，请关闭提示并重新选择提交。")]
    RevisionChanged,
    #[error("补丁超过当前传输大小上限。")]
    PatchTooLarge,
    #[error("未能创建工作树。请确认仓库已有提交，且分支名称未被使用。")]
    Worktree,
    #[error("操作未完成，请稍后重试。")]
    Operation,
    #[error(transparent)]
    WorkspaceActivity(super::error::GuiError),
    #[error("文件信息无效，请刷新后重试。")]
    File,
    #[error("改动文件过多，请先在电脑上整理后重试。")]
    TooManyFiles,
    #[error("文件或分支已变化，请刷新并重新选择文件。")]
    Changed,
    #[error("client.gitConflict.resolveFirst")]
    Conflict,
    #[error("client.gitConflict.unsupported")]
    ConflictUnsupported,
    #[error("client.gitConflict.changed")]
    ConflictChanged,
    #[error("client.gitConflict.markersRemain")]
    ConflictMarkers,
    #[error("client.gitConflict.continueFailed")]
    ContinueFailed,
    #[error("Git 正在执行其他操作，请稍后重试。")]
    Locked,
    #[error("提交未完成，请在电脑上检查 Git 用户信息、提交检查和签名设置。")]
    Commit,
    #[error("请选择文件并填写提交说明。")]
    Selection,
    #[error("请先提交本地改动，再拉取或更新项目。")]
    Dirty,
    #[error("当前分支没有可用的跟踪分支，请先在电脑上设置。")]
    Upstream,
    #[error("项目还没有远程仓库，请先在电脑上添加。")]
    Remote,
    #[error("远程操作未完成，请检查电脑的网络和 Git 登录状态。")]
    Network,
    #[error("client.gitConflict.integrationStopped")]
    Integrate,
    #[error("推送未完成，请先拉取远程改动，或检查推送权限与提交检查。")]
    Push,
}
pub(super) type Result<T> = std::result::Result<T, GitError>;

/// Serializes file mutations initiated by this GUI, including undo.
#[derive(Default)]
pub(crate) struct GitState(pub(super) Arc<Mutex<()>>);

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum GitRequest {
    Status {
        cwd: String,
    },
    Switch {
        cwd: String,
        branch: String,
        create: bool,
    },
    CreateWorktree {
        cwd: String,
        branch: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    cwd: String,
    branch: Option<String>,
    branches: Vec<Branch>,
    changed_files: usize,
    is_worktree: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Branch {
    name: String,
    occupied: bool,
}

pub(super) fn command(cwd: &Path) -> Command {
    command_options(cwd, true)
}

fn command_options(cwd: &Path, disable_hooks: bool) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "submodule.recurse=false",
        ])
        .env("GIT_TERMINAL_PROMPT", "0");
    if disable_hooks {
        command.args(["-c", "core.hooksPath="]);
    }
    // A GUI launched by Git (including checks in hooks) must not inherit another checkout's index or paths.
    for variable in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_INDEX_FILE",
        "GIT_PREFIX",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(variable);
    }
    super::platform::hide_git_window(&mut command);
    command
}

pub(super) fn run(cwd: &Path, args: &[&str]) -> Result<Output> {
    command(cwd)
        .args(args)
        .output()
        .map_err(|_| GitError::Unavailable)
}

fn output(cwd: &Path, args: &[&str]) -> Result<String> {
    let result = run(cwd, args)?;
    if !result.status.success() {
        return Err(GitError::Repository);
    }
    String::from_utf8(result.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|_| GitError::Operation)
}

fn directory(cwd: &str) -> Result<PathBuf> {
    super::protocol::directory(cwd).map_err(|_| GitError::Directory)
}

fn repository(cwd: &Path) -> Result<PathBuf> {
    let root = output(cwd, &["rev-parse", "--show-toplevel"])?;
    let root = directory(&root)?;
    if cwd != root && tool::repositories::contains(&root, cwd)? {
        return Err(GitError::Repository);
    }
    Ok(root)
}

fn validate_branch(cwd: &Path, branch: &str) -> Result<()> {
    if branch.is_empty()
        || branch.len() > 200
        || branch.starts_with('-')
        || branch.contains("@{")
        || !run(cwd, &["check-ref-format", "--branch", branch])?
            .status
            .success()
    {
        return Err(GitError::Branch);
    }
    Ok(())
}

fn status(cwd: &Path) -> Result<GitStatus> {
    let root = repository(cwd)?;
    let branch = output(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    let refs = output(
        &root,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(worktreepath)",
            "refs/heads/",
        ],
    )?;
    let branches = refs
        .lines()
        .map(|line| {
            let (name, path) = line.split_once('\t').unwrap_or((line, ""));
            Branch {
                name: name.to_owned(),
                occupied: !path.is_empty() && branch.as_deref() != Some(name),
            }
        })
        .collect();
    let changes = run(
        &root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !changes.status.success() {
        return Err(GitError::Repository);
    }
    let git_dir = output(&root, &["rev-parse", "--absolute-git-dir"])?;
    let common = output(
        &root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    Ok(GitStatus {
        cwd: execution_path(cwd),
        branch,
        branches,
        changed_files: count_changes(&changes.stdout),
        is_worktree: git_dir != common,
    })
}

fn count_changes(bytes: &[u8]) -> usize {
    let mut records = bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    let mut count = 0;
    while let Some(record) = records.next() {
        count += 1;
        if record
            .iter()
            .take(2)
            .any(|byte| matches!(byte, b'R' | b'C'))
        {
            records.next();
        }
    }
    count
}

fn switch(cwd: &Path, branch: &str, create: bool) -> Result<()> {
    repository(cwd)?;
    validate_branch(cwd, branch)?;
    let args = if create {
        vec!["switch", "-c", branch]
    } else {
        vec!["switch", "--no-guess", branch]
    };
    if !run(cwd, &args)?.status.success() {
        return Err(GitError::Checkout);
    }
    Ok(())
}

fn create_worktree(cwd: &Path, storage: &Path, branch: &str) -> Result<PathBuf> {
    let root = repository(cwd)?;
    validate_branch(&root, branch)?;
    std::fs::create_dir_all(storage).map_err(|_| GitError::Worktree)?;
    let target = storage.join(uuid::Uuid::new_v4().to_string());
    let destination = execution_path(&target);
    if !run(
        &root,
        &["worktree", "add", "-b", branch, "--", &destination, "HEAD"],
    )?
    .status
    .success()
    {
        return Err(GitError::Worktree);
    }
    // Preserve a selected subdirectory, so the new chat starts in the same part of a monorepo.
    let relative = cwd.strip_prefix(&root).map_err(|_| GitError::Directory)?;
    let selected = target.join(relative);
    Ok(if selected.is_dir() { selected } else { target })
}

fn execute(request: GitRequest, storage: &Path) -> Result<GitStatus> {
    match request {
        GitRequest::Status { cwd } => status(&directory(&cwd)?),
        GitRequest::Switch {
            cwd,
            branch,
            create,
        } => {
            let cwd = directory(&cwd)?;
            switch(&cwd, &branch, create)?;
            status(&cwd)
        }
        GitRequest::CreateWorktree { cwd, branch } => {
            let target = create_worktree(&directory(&cwd)?, storage, &branch)?;
            status(&target)
        }
    }
}

#[tauri::command]
pub(crate) async fn codex_gui_git(
    app: AppHandle,
    state: State<'_, GitState>,
    request: GitRequest,
) -> std::result::Result<GitStatus, String> {
    let workspace = match &request {
        GitRequest::Switch { cwd, .. } => Some(workspace_change(&app, cwd.clone()).await?),
        _ => None,
    };
    let guard = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _workspace = workspace;
        let _guard = guard.lock().map_err(|_| GitError::Operation)?;
        let storage = app
            .path()
            .app_data_dir()
            .map_err(|_| GitError::Directory)?
            .join("git-worktrees");
        execute(request, &storage)
    })
    .await
    .map_err(|_| GitError::Operation.to_string())?
    .map_err(|error| error.to_string())
}

async fn workspace_change(
    app: &AppHandle,
    cwd: String,
) -> std::result::Result<super::workspace_activity::WorkspaceChange, String> {
    let key = super::workspace_activity::WorkspaceKey::from_cwd(cwd)
        .await
        .map_err(|error| error.to_string())?;
    let activity = Arc::clone(&app.state::<super::GuiState>().workspaces);
    activity
        .change(key)
        .await
        .map_err(|error| error.to_string())
}
