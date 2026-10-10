//! Fixed application discovery and argument-based launches, without shell interpolation.
use super::{
    apps::{self, ApplicationId},
    FileError, FileTarget, Result,
};
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};
use winreg::{
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
    RegKey,
};

const MAX_INSTALLATIONS: usize = 128;

pub(super) fn validate_path(value: &str) -> Result<()> {
    let tail = if value.as_bytes().get(1) == Some(&b':') {
        if !value.as_bytes()[0].is_ascii_alphabetic() || value.as_bytes().get(2) != Some(&b'/') {
            return Err(FileError::Path);
        }
        &value[2..]
    } else {
        value
    };
    if tail.contains(':') || value.starts_with('/') {
        return Err(FileError::Path);
    }
    for part in tail.split('/') {
        let stem = part
            .split('.')
            .next()
            .unwrap_or_default()
            .trim_end()
            .to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
            || (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit()
        {
            return Err(FileError::Path);
        }
    }
    Ok(())
}

fn under(variable: &str, relative: &str) -> Option<PathBuf> {
    let path = PathBuf::from(env::var_os(variable)?).join(relative);
    path.is_file().then_some(path)
}

fn registered(name: &str) -> Option<PathBuf> {
    let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}");
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]
        .into_iter()
        .find_map(|root| {
            let value: String = RegKey::predef(root)
                .open_subkey(&key)
                .ok()?
                .get_value("")
                .ok()?;
            let path = PathBuf::from(value.trim_matches('"'));
            path.is_file().then_some(path)
        })
}

fn installed_children(root: &Path, prefix: &str, relative: &str) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .take(MAX_INSTALLATIONS)
        .filter_map(std::result::Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_lowercase()
                .starts_with(&prefix.to_lowercase())
        })
        .map(|entry| entry.path().join(relative))
        .find(|path| path.is_file())
}

fn jetbrains(prefix: &str, binary: &str) -> Option<PathBuf> {
    if let Some(path) = registered(binary) {
        return Some(path);
    }
    let relative = format!("bin/{binary}");
    [
        ("ProgramFiles", "JetBrains"),
        ("LOCALAPPDATA", "Programs"),
        ("LOCALAPPDATA", "JetBrains/Toolbox/apps"),
    ]
    .into_iter()
    .find_map(|(variable, suffix)| {
        let root = PathBuf::from(env::var_os(variable)?).join(suffix);
        installed_children(&root, prefix, &relative)
    })
}

fn visual_studio() -> Option<PathBuf> {
    registered("devenv.exe").or_else(|| {
        ["ProgramFiles", "ProgramFiles(x86)"]
            .into_iter()
            .find_map(|variable| {
                let root = PathBuf::from(env::var_os(variable)?).join("Microsoft Visual Studio");
                std::fs::read_dir(root)
                    .ok()?
                    .take(MAX_INSTALLATIONS)
                    .filter_map(std::result::Result::ok)
                    .find_map(|version| {
                        installed_children(&version.path(), "", "Common7/IDE/devenv.exe")
                    })
            })
    })
}

pub(super) fn executable(id: ApplicationId) -> Option<PathBuf> {
    match id {
        ApplicationId::Vscode => registered("Code.exe")
            .or_else(|| under("LOCALAPPDATA", "Programs/Microsoft VS Code/Code.exe"))
            .or_else(|| under("ProgramFiles", "Microsoft VS Code/Code.exe")),
        ApplicationId::VisualStudio => visual_studio(),
        ApplicationId::Terminal => {
            under("LOCALAPPDATA", "Microsoft/WindowsApps/wt.exe").or_else(|| {
                under(
                    "SystemRoot",
                    "System32/WindowsPowerShell/v1.0/powershell.exe",
                )
            })
        }
        ApplicationId::GitBash => under("ProgramFiles", "Git/git-bash.exe")
            .or_else(|| under("LOCALAPPDATA", "Programs/Git/git-bash.exe")),
        ApplicationId::Wsl => under("SystemRoot", "System32/wsl.exe"),
        ApplicationId::AndroidStudio => registered("studio64.exe")
            .or_else(|| under("ProgramFiles", "Android/Android Studio/bin/studio64.exe")),
        ApplicationId::Idea => jetbrains("IntelliJ IDEA", "idea64.exe"),
        ApplicationId::Pycharm => jetbrains("PyCharm", "pycharm64.exe"),
        ApplicationId::Webstorm => jetbrains("WebStorm", "webstorm64.exe"),
        ApplicationId::Phpstorm => jetbrains("PhpStorm", "phpstorm64.exe"),
        ApplicationId::Other => under("SystemRoot", "System32/rundll32.exe"),
        ApplicationId::Explorer => under("SystemRoot", "explorer.exe"),
        ApplicationId::Default => None,
    }
}

pub(super) fn icon(executable: &Path) -> Option<String> {
    super::icons_windows::read(executable)
}

pub(super) fn command(
    id: ApplicationId,
    executable: &Path,
    path: &Path,
    target: &FileTarget,
) -> Result<Command> {
    let mut command = Command::new(executable);
    let directory = apps::containing_directory(path)?;
    let directory = super::super::platform::execution_path(&directory);
    command.current_dir(&directory);
    match id {
        ApplicationId::Terminal => {
            if executable
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("wt.exe"))
            {
                command.args(["-d", &directory]);
            } else {
                command.arg("-NoLogo");
            }
        }
        ApplicationId::GitBash => {
            command.arg(format!("--cd={directory}"));
        }
        ApplicationId::Wsl => {
            command.args(["--cd", &directory]);
        }
        ApplicationId::Other => {
            command
                .arg("shell32.dll,OpenAs_RunDLL")
                .arg(super::super::platform::execution_path(path));
        }
        _ => apps::editor_arguments(&mut command, id, path, target),
    }
    Ok(command)
}
