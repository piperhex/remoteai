//! Process control is limited to validated desktop installation paths.

use std::{
    fmt,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

mod native;

const DESKTOP_SHELL: &str = "ChatGPT.exe";
const DESKTOP_HELPER: &str = "codex.exe";
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(150);
const STOP_TIMEOUT: Duration = Duration::from_secs(10);
const WINDOW_CLOSE_GRACE: Duration = Duration::from_secs(3);

#[derive(Debug)]
pub(crate) enum ProcessControlError {
    UnverifiedInstallation,
    ExitTimedOut,
    RestartedDuringStop,
}

impl fmt::Display for ProcessControlError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnverifiedInstallation => "无法确认桌面应用的位置，已取消重启。",
            Self::ExitTimedOut => "桌面应用尚未完全退出，请关闭后重试。",
            Self::RestartedDuringStop => "桌面应用已重新启动，已取消本次操作，请稍后重试。",
        })
    }
}

impl std::error::Error for ProcessControlError {}

struct ObservedProcess {
    pid: u32,
    started_at: u64,
    executable: PathBuf,
}

fn same_process_instance(left: &ObservedProcess, right: &ObservedProcess) -> bool {
    left.pid == right.pid
        && left.started_at == right.started_at
        && path_key(&left.executable) == path_key(&right.executable)
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{value}").to_ascii_lowercase();
    }
    value
        .strip_prefix(r"\\?\")
        .unwrap_or(&value)
        .to_ascii_lowercase()
}

fn is_named(path: &Path, name: &str) -> bool {
    path.file_name()
        .is_some_and(|value| value.eq_ignore_ascii_case(name))
}

fn desktop_shell_candidate(executable: &Path) -> Option<PathBuf> {
    let parent = executable.parent()?;
    let app_dir = if is_named(executable, DESKTOP_SHELL) {
        parent
    } else if is_named(executable, DESKTOP_HELPER) && is_named(parent, "resources") {
        parent.parent()?
    } else {
        return None;
    };
    is_named(app_dir, "app").then(|| app_dir.join(DESKTOP_SHELL))
}

fn matches_install_executable(executable: &Path, shell: &Path) -> bool {
    let Some(app_dir) = shell.parent() else {
        return false;
    };
    let executable = path_key(executable);
    executable == path_key(shell)
        || executable == path_key(&app_dir.join("resources").join(DESKTOP_HELPER))
}

fn validated_shell(shell: &Path) -> Option<PathBuf> {
    let shell = shell.canonicalize().ok()?;
    if !shell.is_file()
        || desktop_shell_candidate(&shell)
            .is_none_or(|candidate| path_key(&candidate) != path_key(&shell))
    {
        return None;
    }
    let helper = shell.parent()?.join("resources").join(DESKTOP_HELPER);
    // A redirected helper must not extend process control beyond this installation.
    if !helper.is_file() || path_key(&helper.canonicalize().ok()?) != path_key(&helper) {
        return None;
    }
    Some(shell)
}

fn process_snapshot() -> System {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    system
}

fn desktop_shells(system: &System) -> Vec<PathBuf> {
    let mut shells: Vec<PathBuf> = Vec::new();
    for process in system.processes().values() {
        let Some(shell) = process
            .exe()
            .and_then(desktop_shell_candidate)
            .and_then(|path| validated_shell(&path))
        else {
            continue;
        };
        if !shells
            .iter()
            .any(|existing| path_key(existing) == path_key(&shell))
        {
            shells.push(shell);
        }
    }
    shells
}

/// Finds shells using executable paths and the desktop's bundled helper layout.
/// A standalone CLI, including one named `codex.exe`, never qualifies by name alone.
pub(crate) fn running_desktop_shells() -> Vec<PathBuf> {
    desktop_shells(&process_snapshot())
}

pub(crate) fn desktop_is_running() -> bool {
    !running_desktop_shells().is_empty()
}

/// Stops only shells/helpers in the installations observed when this operation starts.
pub(crate) fn stop_desktop_processes() -> Result<(), ProcessControlError> {
    for shell in running_desktop_shells() {
        stop_install_processes(&shell, STOP_TIMEOUT)?;
    }
    Ok(())
}

/// Waits without terminating a new installation that may have appeared during an update.
pub(crate) fn wait_for_desktop_exit(timeout: Duration) -> Result<(), ProcessControlError> {
    let deadline = Instant::now() + timeout;
    while desktop_is_running() {
        if Instant::now() >= deadline {
            return Err(ProcessControlError::ExitTimedOut);
        }
        thread::sleep(EXIT_POLL_INTERVAL);
    }
    Ok(())
}

fn observe_process(process: &sysinfo::Process) -> Option<ObservedProcess> {
    Some(ObservedProcess {
        pid: process.pid().as_u32(),
        started_at: process.start_time(),
        executable: process.exe()?.to_path_buf(),
    })
}

fn observed_processes_are_running(observed: &[ObservedProcess]) -> bool {
    let system = process_snapshot();
    observed.iter().any(|expected| {
        system
            .process(sysinfo::Pid::from_u32(expected.pid))
            .and_then(observe_process)
            .is_some_and(|current| same_process_instance(&current, expected))
    })
}

fn check_installation_exit(
    shell: &Path,
    remaining: &[ObservedProcess],
) -> Result<(), ProcessControlError> {
    if remaining
        .iter()
        .any(|process| matches_install_executable(&process.executable, shell))
    {
        return Err(ProcessControlError::RestartedDuringStop);
    }
    Ok(())
}

/// Stops only the initially observed processes in a confirmed installation.
/// Respawned processes and reused PIDs are never terminated by the exit wait.
pub(crate) fn stop_install_processes(
    shell: &Path,
    timeout: Duration,
) -> Result<(), ProcessControlError> {
    let shell = validated_shell(shell).ok_or(ProcessControlError::UnverifiedInstallation)?;
    let observed = process_snapshot()
        .processes()
        .values()
        .filter_map(observe_process)
        .filter(|process| matches_install_executable(&process.executable, &shell))
        .collect::<Vec<_>>();
    let deadline = Instant::now() + timeout;
    if native::request_window_close(&observed) {
        let grace = deadline.min(Instant::now() + WINDOW_CLOSE_GRACE);
        while Instant::now() < grace && observed_processes_are_running(&observed) {
            thread::sleep(EXIT_POLL_INTERVAL);
        }
    }
    for process in &observed {
        // A disappearing process or denied handle can make termination fail. The
        // wait confirms whether this exact instance is gone and reports a timeout.
        native::terminate_observed_process(process);
    }
    while observed_processes_are_running(&observed) {
        if Instant::now() >= deadline {
            return Err(ProcessControlError::ExitTimedOut);
        }
        thread::sleep(EXIT_POLL_INTERVAL);
    }
    // A bootstrap may replace an observed process while it is exiting. Leave
    // that replacement untouched and cancel launch instead of reusing its runtime.
    let remaining = process_snapshot()
        .processes()
        .values()
        .filter_map(observe_process)
        .collect::<Vec<_>>();
    check_installation_exit(&shell, &remaining)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHELL: &str = r"C:\Program Files\WindowsApps\OpenAI.Codex_1\app\ChatGPT.exe";

    #[test]
    fn recognizes_only_desktop_shell_and_bundled_helper_layouts() {
        assert_eq!(
            desktop_shell_candidate(Path::new(SHELL)),
            Some(PathBuf::from(SHELL))
        );
        assert_eq!(
            desktop_shell_candidate(Path::new(
                r"C:\Program Files\WindowsApps\OpenAI.Codex_1\app\resources\codex.exe"
            )),
            Some(PathBuf::from(SHELL)),
        );
        for path in [
            r"C:\Users\user\AppData\Roaming\npm\codex.exe",
            r"C:\tools\codex.exe",
            r"C:\tools\ChatGPT.exe",
            r"C:\other\resources\codex.exe",
            r"C:\other\app\codex.exe",
        ] {
            assert_eq!(desktop_shell_candidate(Path::new(path)), None, "{path}");
        }
    }

    #[test]
    fn process_scope_excludes_other_versions_and_cli_paths() {
        let shell = Path::new(SHELL);
        assert!(matches_install_executable(shell, shell));
        assert!(matches_install_executable(
            Path::new(r"C:\Program Files\WindowsApps\OpenAI.Codex_1\app\resources\codex.exe"),
            shell
        ));
        for path in [
            r"C:\Program Files\WindowsApps\OpenAI.Codex_2\app\ChatGPT.exe",
            r"C:\Program Files\WindowsApps\OpenAI.Codex_2\app\resources\codex.exe",
            r"C:\tools\codex.exe",
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1\app\resources\other\codex.exe",
        ] {
            assert!(
                !matches_install_executable(Path::new(path), shell),
                "{path}"
            );
        }
    }

    #[test]
    fn process_scope_accepts_windows_verbatim_paths_and_case_differences() {
        assert!(matches_install_executable(
            Path::new(r"\\?\C:\PROGRAM FILES\WINDOWSAPPS\OPENAI.CODEX_1\APP\CHATGPT.EXE"),
            Path::new(SHELL),
        ));
    }

    #[test]
    fn exit_wait_does_not_follow_reused_pids_or_restarted_processes() {
        let original = ObservedProcess {
            pid: 12,
            started_at: 100,
            executable: PathBuf::from(SHELL),
        };
        let mut current = ObservedProcess {
            pid: 12,
            started_at: 100,
            executable: PathBuf::from(SHELL),
        };
        assert!(same_process_instance(&original, &current));
        current.started_at = 101;
        assert!(!same_process_instance(&original, &current));
        current.started_at = 100;
        current.pid = 13;
        assert!(!same_process_instance(&original, &current));
        current.pid = 12;
        current.executable = PathBuf::from(r"C:\tools\codex.exe");
        assert!(!same_process_instance(&original, &current));
    }

    #[test]
    fn a_replacement_in_the_same_installation_cancels_launch() {
        let original = ObservedProcess {
            pid: 12,
            started_at: 100,
            executable: PathBuf::from(SHELL),
        };
        for executable in [
            SHELL,
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1\app\resources\codex.exe",
        ] {
            let replacement = ObservedProcess {
                pid: 13,
                started_at: 101,
                executable: PathBuf::from(executable),
            };
            assert!(!same_process_instance(&original, &replacement));
            assert!(matches!(
                check_installation_exit(Path::new(SHELL), &[replacement]),
                Err(ProcessControlError::RestartedDuringStop),
            ));
        }
    }

    #[test]
    fn another_installation_does_not_block_stop_completion() {
        let other = ObservedProcess {
            pid: 13,
            started_at: 101,
            executable: PathBuf::from(
                r"C:\Program Files\WindowsApps\OpenAI.Codex_2\app\ChatGPT.exe",
            ),
        };
        assert!(check_installation_exit(Path::new(SHELL), &[other]).is_ok());
        assert!(check_installation_exit(Path::new(SHELL), &[]).is_ok());
    }
}
