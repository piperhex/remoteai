//! Extension installation is scoped to the unprivileged browser profile, never the application WebView.
mod chrome;
mod manifest;
mod package;
#[cfg(all(test, windows))]
mod smoke;
mod transfer;
#[cfg(windows)]
mod windows;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("market.extensionsUnsupported")]
    Unsupported,
    #[error("market.extensionsInvalid")]
    Invalid,
    #[error("market.extensionsFailed")]
    Engine,
    #[error("market.extensionsStorageFailed")]
    Storage,
    #[error("market.extensionsMissing")]
    Missing,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    List,
    Discover,
    Install {
        path: String,
    },
    BeginUpload {
        files: Vec<transfer::FileInfo>,
    },
    WriteUpload {
        token: String,
        path: String,
        offset: u64,
        data: String,
    },
    FinishUpload {
        token: String,
    },
    Export {
        path: String,
    },
    ReadExport {
        token: String,
        offset: u64,
    },
    ReleaseTransfer {
        token: String,
    },
    Enable {
        id: String,
        enabled: bool,
    },
    Remove {
        id: String,
    },
    Pin {
        id: String,
        pinned: bool,
    },
    Open {
        id: String,
    },
}

#[derive(Default, Deserialize, Serialize)]
struct Catalog {
    entries: Vec<Record>,
}
#[derive(Deserialize, Serialize)]
struct Record {
    id: String,
    directory: String,
    pinned: bool,
    #[serde(flatten)]
    manifest: manifest::Manifest,
}

fn root(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("browser-extensions"))
        .map_err(|_| Error::Storage)
}
fn read(root: &Path) -> Result<Catalog> {
    match fs::read(root.join("catalog.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| Error::Storage),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Catalog::default()),
        Err(_) => Err(Error::Storage),
    }
}
fn save(root: &Path, catalog: &Catalog) -> Result<()> {
    fs::create_dir_all(root).map_err(|_| Error::Storage)?;
    crate::storage::write_json_atomic(&root.join("catalog.json"), &json!(catalog))
        .map_err(|_| Error::Storage)
}

pub(crate) async fn execute(app: AppHandle, request: Request) -> Result<Value> {
    // Serialize the complete installation/catalog transaction without blocking the UI thread.
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = SERIAL.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(result) = transfer::execute(&request) {
            return result;
        }
        perform(&app, request)
    })
    .await
    .map_err(|_| Error::Engine)?
}

#[cfg(not(windows))]
fn perform(_: &AppHandle, request: Request) -> Result<Value> {
    if matches!(request, Request::List) {
        return Ok(json!({"supported": false, "entries": []}));
    }
    Err(Error::Unsupported)
}

#[cfg(windows)]
fn perform(app: &AppHandle, request: Request) -> Result<Value> {
    use windows::Operation;
    if matches!(request, Request::Discover) {
        return Ok(json!({"candidates": chrome::discover()?}));
    }
    let root = root(app)?;
    let mut catalog = read(&root)?;
    let view = manager(app)?;
    match request {
        Request::List => {}
        Request::Install { path } => install(&view, &root, &mut catalog, &path)?,
        Request::FinishUpload { token } => {
            let source = transfer::finish(&token)?;
            let path = transfer::uploaded_source(source.path())?;
            install(&view, &root, &mut catalog, &path.to_string_lossy())?;
        }
        Request::Enable { id, enabled } => {
            require_managed(&catalog, &id)?;
            windows::execute(&view, Operation::Enable(id.clone(), enabled))?;
            if !enabled {
                close_popup(app, &id)?;
            }
        }
        Request::Remove { id } => {
            require_managed(&catalog, &id)?;
            windows::execute(&view, Operation::Remove(id.clone()))?;
            close_popup(app, &id)?;
            catalog.entries.retain(|entry| entry.id != id);
            save(&root, &catalog)?;
            // Keep immutable assets: a late engine callback may still refer to them.
        }
        Request::Pin { id, pinned } => {
            catalog
                .entries
                .iter_mut()
                .find(|entry| entry.id == id)
                .ok_or(Error::Missing)?
                .pinned = pinned;
            save(&root, &catalog)?;
        }
        Request::Open { id } => {
            if !windows::execute(&view, Operation::List)?
                .iter()
                .any(|entry| entry.id == id && entry.enabled)
            {
                return Err(Error::Missing);
            }
            open(app, &catalog, &id)?;
        }
        _ => return Err(Error::Invalid),
    }
    let installed = windows::execute(&view, Operation::List)?;
    let entries = installed_entries(installed, &catalog);
    Ok(json!({"supported": true, "entries": entries}))
}

#[cfg(windows)]
fn require_managed(catalog: &Catalog, id: &str) -> Result<()> {
    if catalog.entries.iter().any(|entry| entry.id == id) {
        return Ok(());
    }
    Err(Error::Missing)
}

#[cfg(windows)]
fn installed_entries(installed: Vec<windows::Installed>, catalog: &Catalog) -> Vec<Value> {
    installed.into_iter().filter_map(|installed| {
        // WebView2 also reports engine components such as its PDF viewer. They are not user-installed
        // extensions and have no catalog, icons or supported management controls.
        let record = catalog.entries.iter().find(|entry| entry.id == installed.id)?;
        Some(json!({ "id": installed.id, "name": installed.name, "enabled": installed.enabled,
            "pinned": record.pinned, "version": record.manifest.version, "icon": record.manifest.icon,
            "popup": record.manifest.popup.is_some(), "permissions": record.manifest.permissions }))
    }).collect()
}

#[cfg(windows)]
fn manager(app: &AppHandle) -> Result<tauri::Webview> {
    const LABEL: &str = "browser-extension-manager";
    if let Some(view) = app.get_webview(LABEL) {
        return Ok(view);
    }
    let owner = app.get_webview("main").ok_or(Error::Engine)?;
    let builder = super::browser_builder(&owner, LABEL).map_err(|_| Error::Engine)?;
    let view = owner
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(-32_768.0, 0.0),
            tauri::LogicalSize::new(1.0, 1.0),
        )
        .map_err(|_| Error::Engine)?;
    view.hide().map_err(|_| Error::Engine)?;
    Ok(view)
}

#[cfg(windows)]
fn install(view: &tauri::Webview, root: &Path, catalog: &mut Catalog, source: &str) -> Result<()> {
    if source.is_empty() || source.len() > 32_768 {
        return Err(Error::Invalid);
    }
    let directory = uuid::Uuid::new_v4().to_string();
    let destination = root.join(&directory);
    let source = package::prepare(Path::new(source))?;
    manifest::copy(&source.path, &destination)?;
    let manifest = manifest::read(&destination)?;
    let installed = windows::execute(view, windows::Operation::Add(destination))?;
    let installed = installed.first().ok_or(Error::Engine)?;
    let pinned = catalog
        .entries
        .iter()
        .find(|entry| entry.id == installed.id)
        .is_some_and(|entry| entry.pinned);
    catalog.entries.retain(|entry| entry.id != installed.id);
    catalog.entries.push(Record {
        id: installed.id.clone(),
        directory,
        pinned,
        manifest,
    });
    save(root, catalog)
}

#[cfg(windows)]
fn close_popup(app: &AppHandle, id: &str) -> Result<()> {
    if let Some(popup) = app.get_webview_window(&format!("browser-extension-{id}")) {
        popup.close().map_err(|_| Error::Engine)?;
    }
    Ok(())
}

#[cfg(windows)]
fn open(app: &AppHandle, catalog: &Catalog, id: &str) -> Result<()> {
    let record = catalog
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or(Error::Missing)?;
    let popup = record.manifest.popup.as_ref().ok_or(Error::Missing)?;
    let url =
        url::Url::parse(&format!("chrome-extension://{id}/{popup}")).map_err(|_| Error::Invalid)?;
    let label = format!("browser-extension-{id}");
    if let Some(view) = app.get_webview_window(&label) {
        view.show().map_err(|_| Error::Engine)?;
        return view.set_focus().map_err(|_| Error::Engine);
    }
    // This window receives no application capabilities. Only this extension's pages may navigate.
    let extension_id = id.to_owned();
    crate::webview_windows::builder(app, &label, tauri::WebviewUrl::External(url))
        .data_directory(
            app.path()
                .app_data_dir()
                .map_err(|_| Error::Storage)?
                .join("browser-profile"),
        )
        .browser_extensions_enabled(true)
        .title(&record.manifest.name)
        .inner_size(420.0, 600.0)
        .on_navigation(move |url| {
            url.scheme() == "chrome-extension" && url.host_str() == Some(&extension_id)
        })
        .on_download(|_, _| false)
        .build()
        .map_err(|_| Error::Engine)?;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn engine_components_are_not_listed_or_mutable() {
        let catalog = Catalog {
            entries: vec![Record {
                id: "managed".into(),
                directory: "private".into(),
                pinned: true,
                manifest: manifest::Manifest::default(),
            }],
        };
        let installed = ["managed", "engine-component"]
            .into_iter()
            .map(|id| windows::Installed {
                id: id.into(),
                name: id.into(),
                enabled: true,
            })
            .collect();
        let visible = installed_entries(installed, &catalog);
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0]["id"], "managed");
        assert_eq!(visible[0]["pinned"], true);
        assert!(require_managed(&catalog, "managed").is_ok());
        assert!(matches!(
            require_managed(&catalog, "engine-component"),
            Err(Error::Missing)
        ));
    }
}
