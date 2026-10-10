use std::{sync::Arc, time::Duration};

use serde::Serialize;
use tauri::{ipc::Channel, Manager, Resource, ResourceId, Runtime, State, Webview};
use tauri_plugin_updater::Update;

#[cfg(test)]
use super::transfer;
use super::{cache::Artifact, parallel, Error, Result, Service, TRANSFER_LIFETIME};

struct VerifiedPackage {
    artifact: String,
    bytes: Arc<Vec<u8>>,
}

#[cfg(test)]
#[path = "download_tests.rs"]
mod tests;
impl Resource for VerifiedPackage {}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub(crate) enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

struct Progress {
    channel: Channel<DownloadEvent>,
    started: bool,
}

impl Progress {
    fn chunk(&mut self, length: usize, total: Option<u64>) {
        if !self.started {
            self.emit(DownloadEvent::Started {
                content_length: total,
            });
            self.started = true;
        }
        self.emit(DownloadEvent::Progress {
            chunk_length: length,
        });
    }

    fn emit(&self, event: DownloadEvent) {
        // Closing the window does not cancel a verified background download.
        let _delivered = self.channel.send(event);
    }
}

#[tauri::command]
pub(crate) async fn download_shared_app_update<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    on_event: Channel<DownloadEvent>,
    service: State<'_, Arc<Service>>,
) -> std::result::Result<ResourceId, String> {
    if webview.label() != "main" {
        return Err("Update download is unavailable".into());
    }
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|_| "Please check for updates again".to_owned())?;
    let _permit = service
        .downloads
        .try_acquire()
        .map_err(|_| "An update is already downloading".to_owned())?;
    let mut progress = Progress {
        channel: on_event,
        started: false,
    };
    let package = resolve(&service, &update, &mut progress).await?;
    progress.emit(DownloadEvent::Finished);
    Ok(webview.resources_table().add(package))
}

async fn resolve(
    service: &Arc<Service>,
    update: &Update,
    progress: &mut Progress,
) -> std::result::Result<VerifiedPackage, String> {
    let artifact = Artifact::from_update(update);
    if let Ok(bytes) = service.cache.read(&artifact.id).await {
        progress.chunk(bytes.len(), Some(bytes.len() as u64));
        eprintln!("update package download source: cache");
        return Ok(VerifiedPackage {
            artifact: artifact.id,
            bytes: Arc::new(bytes),
        });
    }
    let bytes = download(service, update, &artifact, progress).await?;
    // Disk/cache errors cannot prevent installation of an already verified package.
    if let Err(error) = service.cache.save(artifact.clone(), bytes.clone()).await {
        eprintln!("could not cache the verified update package: {error}");
    }
    Ok(VerifiedPackage {
        artifact: artifact.id,
        bytes,
    })
}

async fn download(
    service: &Arc<Service>,
    update: &Update,
    artifact: &Artifact,
    progress: &mut Progress,
) -> std::result::Result<Arc<Vec<u8>>, String> {
    if let Ok(bytes) = download_peer(service, artifact, progress).await {
        eprintln!("update package download source: peer");
        return Ok(bytes);
    }
    eprintln!("update peer unavailable; downloading the package from GitHub");
    progress.started = false;
    let mut origin = update.clone();
    // The manifest's 10-second check timeout must not truncate an installer download.
    origin.timeout = Some(Duration::from_secs(30 * 60));
    origin
        .download(|length, total| progress.chunk(length, total), || {})
        .await
        .map(Arc::new)
        .map_err(|_| "Could not download the update. Please try again.".to_owned())
}

async fn download_peer(
    service: &Arc<Service>,
    artifact: &Artifact,
    progress: &mut Progress,
) -> Result<Arc<Vec<u8>>> {
    let leases = service.find_peers(&artifact.id).await?;
    let bytes = tokio::time::timeout(
        TRANSFER_LIFETIME,
        parallel::download(&leases, &artifact.id, |length, total| {
            progress.chunk(length, total)
        }),
    )
    .await
    .map_err(|_| Error::Unavailable)??;
    let artifact = artifact.clone();
    let key = service.cache.key.clone();
    tokio::task::spawn_blocking(move || {
        artifact.verify(&bytes, &key)?;
        Ok(Arc::new(bytes))
    })
    .await
    .map_err(|_| Error::Unavailable)?
}

#[tauri::command]
pub(crate) async fn install_shared_app_update<R: Runtime>(
    webview: Webview<R>,
    update_rid: ResourceId,
    bytes_rid: ResourceId,
) -> std::result::Result<(), String> {
    if webview.label() != "main" {
        return Err("Update installation is unavailable".into());
    }
    let update = webview
        .resources_table()
        .get::<Update>(update_rid)
        .map_err(|_| "Please check for updates again".to_owned())?;
    let package = webview
        .resources_table()
        .get::<VerifiedPackage>(bytes_rid)
        .map_err(|_| "Please download the update again".to_owned())?;
    if Artifact::from_update(&update).id != package.artifact {
        return Err("The available update has changed. Please check again.".into());
    }
    tauri::async_runtime::spawn_blocking(move || update.install(package.bytes.as_slice()))
        .await
        .map_err(|_| "Could not install the update".to_owned())?
        .map_err(|_| "Could not install the update. Please try again.".to_owned())?;
    webview
        .resources_table()
        .close(bytes_rid)
        .map_err(|_| "Could not release the update".to_owned())
}
