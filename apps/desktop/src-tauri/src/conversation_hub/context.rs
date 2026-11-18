use crate::storage::Paths;
use tauri::{AppHandle, Runtime};

/// A request owns a resolved home; subsequent settings changes cannot redirect its work.
pub(crate) struct ThreadContext<R: Runtime> {
    pub(super) app: AppHandle<R>,
    pub(super) paths: Paths,
}

impl<R: Runtime> ThreadContext<R> {
    pub(crate) fn new(app: AppHandle<R>, home_id: Option<String>) -> Result<Self, String> {
        let home = crate::codex_home::resolve_selected(&app, home_id.as_deref())?;
        Self::for_home(app, home)
    }

    pub(super) fn for_home(app: AppHandle<R>, home: std::path::PathBuf) -> Result<Self, String> {
        let mut paths = crate::storage::resolve_paths(&app)?;
        paths.current_auth = home.join("auth.json");
        paths.current_config = home.join("config.toml");
        paths.codex_home = home;
        Ok(Self { app, paths })
    }
}
