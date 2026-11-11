use super::{
    super::{install, ComputerError, Result, CHANGES},
    lease,
    native::Process,
};
use std::path::Path;

pub(super) fn start(
    process: Process,
    root: &Path,
    home: &Path,
    grant: &lease::Lease,
) -> Result<()> {
    let (root, home, grant) = (root.to_owned(), home.to_owned(), grant.clone());
    std::thread::Builder::new()
        .name("cua-administrator-exit".into())
        .spawn(move || {
            let result = process.wait().and_then(|()| {
                let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
                let id = super::super::state::home_id(&home);
                if lease::read(&root, &id)?.is_some_and(|saved| saved.id == grant.id) {
                    lease::remove(&root, &id)?;
                    // The changed MCP configuration lets the next turn reconnect in ordinary mode.
                    install::refresh_installed(&root, &home)?;
                }
                Ok(())
            });
            if let Err(error) = result {
                eprintln!("Computer-use administrator cleanup failed: {error}");
            }
        })
        .map_err(|_| ComputerError::Administrator)?;
    Ok(())
}
