// Only framework adapters are substituted. Filesystem, locking, hashing and save code are production source.

pub mod error {
    #[derive(Debug, thiserror::Error)]
    pub enum GuiError {
        #[error("FileBusy")]
        FileBusy,
        #[error("FileRead")]
        FileRead,
        #[error("FileTooLarge")]
        FileTooLarge,
        #[error("FileExpired")]
        FileExpired,
        #[error("TextPreview")]
        TextPreview,
        #[error("ProjectFileWrite")]
        ProjectFileWrite,
        #[error("client.projectBrowser.thisFileChangedElsewhereCopyYourEditsBeforeReloadingIt")]
        ProjectFileConflict,
        #[error("InvalidRequest")]
        InvalidRequest,
        #[error("ProjectFiles")]
        ProjectFiles,
    }
    pub type Result<T> = std::result::Result<T, GuiError>;
}
pub mod protocol {
    pub struct GuiResponse {
        pub data: serde_json::Value,
    }
}
pub mod platform {
    pub fn execution_path(path: &std::path::Path) -> String {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('\\', "/")
    }
}
pub mod git {
    pub fn command(path: &std::path::Path) -> std::process::Command {
        let mut command = std::process::Command::new("git");
        command.current_dir(path);
        command
    }
}

pub async fn handle(input: serde_json::Value) -> error::Result<serde_json::Value> {
    let response = match input["operation"].as_str() {
        Some("projectFileRead") => {
            project_editor::read(
                serde_json::from_value(input).map_err(|_| error::GuiError::InvalidRequest)?,
            )
            .await?
        }
        Some("projectFileWrite") => {
            project_editor::write(
                serde_json::from_value(input).map_err(|_| error::GuiError::InvalidRequest)?,
            )
            .await?
        }
        _ => return Err(error::GuiError::InvalidRequest),
    };
    Ok(response.data)
}
