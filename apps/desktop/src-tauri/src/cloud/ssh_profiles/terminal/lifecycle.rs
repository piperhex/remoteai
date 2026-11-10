use super::*;
use std::sync::Weak;

const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const CHECK_INTERVAL: Duration = Duration::from_secs(30);

pub(super) async fn close_remote(client: &Client, entry: &Terminal) -> Result<()> {
    client
        .command(Command::Close {
            id: entry.remote_id.clone(),
        })
        .await?;
    entry.buffer.event(Event::Exit { code: None });
    Ok(())
}

pub(super) async fn remove<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<()> {
    let state = registry(app);
    let entry = state.entries.lock().await.get(id).cloned();
    if let Some(entry) = entry {
        close_remote(app.state::<Arc<Client>>().inner(), &entry).await?;
        state.entries.lock().await.remove(id);
    }
    Ok(())
}

pub(super) fn watch<R: Runtime>(app: AppHandle<R>, id: String, entry: Weak<Terminal>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(CHECK_INTERVAL).await;
            let Some(entry) = entry.upgrade() else {
                break;
            };
            if entry.buffer.expired(IDLE_TIMEOUT) || check(&app, &entry.owner).await.is_err() {
                match remove(&app, &id).await {
                    Ok(()) => break,
                    Err(error) => eprintln!("SSH agent terminal cleanup: {error}"),
                }
            }
        }
    });
}

pub(crate) fn close_agent_ssh_terminals(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<Registry>>() else {
        return;
    };
    let (state, app) = (state.inner().clone(), app.clone());
    tauri::async_runtime::spawn(async move {
        let entries: Vec<_> = state
            .entries
            .lock()
            .await
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in entries {
            if let Err(error) = close_remote(app.state::<Arc<Client>>().inner(), &entry).await {
                // Application shutdown owns final transport teardown if graceful close fails.
                eprintln!("SSH agent terminal shutdown: {error}");
            }
        }
    });
}
