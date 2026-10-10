use super::{
    apps::{self, ApplicationId},
    FileError, FileTarget, Result,
};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub(super) fn executable(id: ApplicationId) -> Option<PathBuf> {
    let paths: &[&str] = match id {
        ApplicationId::Vscode => &[
            "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
            "/usr/bin/code",
            "/usr/local/bin/code",
            "/snap/bin/code",
        ],
        ApplicationId::Terminal => &[
            "/System/Applications/Utilities/Terminal.app",
            "/usr/bin/x-terminal-emulator",
            "/usr/bin/gnome-terminal",
            "/usr/bin/konsole",
        ],
        ApplicationId::AndroidStudio => &[
            "/Applications/Android Studio.app/Contents/MacOS/studio",
            "/opt/android-studio/bin/studio",
        ],
        ApplicationId::Idea => &[
            "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
            "/usr/local/bin/idea",
        ],
        ApplicationId::Pycharm => &[
            "/Applications/PyCharm.app/Contents/MacOS/pycharm",
            "/usr/local/bin/pycharm",
        ],
        ApplicationId::Webstorm => &[
            "/Applications/WebStorm.app/Contents/MacOS/webstorm",
            "/usr/local/bin/webstorm",
        ],
        ApplicationId::Phpstorm => &[
            "/Applications/PhpStorm.app/Contents/MacOS/phpstorm",
            "/usr/local/bin/phpstorm",
        ],
        _ => &[],
    };
    paths.iter().map(PathBuf::from).find(|path| path.exists())
}

pub(super) fn icon(_: &Path) -> Option<String> {
    None
}

pub(super) fn command(
    id: ApplicationId,
    executable: &Path,
    path: &Path,
    target: &FileTarget,
) -> Result<Command> {
    if id == ApplicationId::Terminal
        && executable
            .extension()
            .is_some_and(|extension| extension == "app")
    {
        let mut command = Command::new("/usr/bin/open");
        command
            .arg("-a")
            .arg(executable)
            .arg(apps::containing_directory(path)?);
        return Ok(command);
    }
    if !executable.is_file() {
        return Err(FileError::Application);
    }
    let mut command = Command::new(executable);
    command.current_dir(apps::containing_directory(path)?);
    if id != ApplicationId::Terminal {
        apps::editor_arguments(&mut command, id, path, target);
    }
    Ok(command)
}
