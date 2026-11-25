use super::*;
use crate::codex_gui::{identity, platform};
use std::process::Stdio;
use tauri::Manager;

pub(super) struct ServerProcess {
    pub(super) process: Child,
    #[cfg(windows)]
    pub(super) plugin_host: crate::windows_plugin_host::Host,
}

impl Client {
    pub(in crate::codex_gui) async fn start(
        app: AppHandle,
        executable: crate::codex_gui::releases::Executable,
        home: PathBuf,
        projectless_root: PathBuf,
    ) -> Result<Arc<Self>> {
        let client = Self::start_staged(app, executable, home, projectless_root).await?;
        client.activate();
        Ok(client)
    }

    /// Handshake before replacing the current client; failed updates must not publish disconnects.
    pub(in crate::codex_gui) async fn start_staged(
        app: AppHandle,
        executable: crate::codex_gui::releases::Executable,
        home: PathBuf,
        projectless_root: PathBuf,
    ) -> Result<Arc<Self>> {
        let mut command = crate::codex_gui::cli_command::new(&executable.path);
        // Keep every override in the app-server argument scope; subcommand overrides replace root ones.
        command.arg("app-server");
        crate::codex_gui::conversation_tools::configure(app.clone(), &mut command).await?;
        #[cfg(windows)]
        let plugin_host =
            crate::windows_plugin_host::Host::start(&home).map_err(|_| GuiError::Startup)?;
        #[cfg(windows)]
        plugin_host.configure(&mut command);
        command
            .arg("-c")
            .arg("features.step_model_switching=true")
            .arg("-c")
            .arg(context_capacity::UNLOAD_CONFIG)
            .arg("-c")
            .arg(format!("sqlite_home={}", json!(home.to_string_lossy())))
            .arg("-c")
            .arg(format!(
                "log_dir={}",
                json!(home.join("log").to_string_lossy())
            ))
            .env("CODEX_HOME", &home)
            .env(
                "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
                identity::CLI_ORIGINATOR,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        context_usage::configure(&mut command);
        platform::hide_window(&mut command);
        let server = ServerProcess {
            process: command.spawn().map_err(|_| GuiError::Startup)?,
            #[cfg(windows)]
            plugin_host,
        };
        let client = Self::attach(app, home, projectless_root, server).await?;
        let handshake = client
            .request(
                "initialize",
                identity::initialize_params(&executable.version),
            )
            .await;
        if handshake.is_err() {
            client.stop().await;
            return Err(GuiError::Startup);
        }
        if client
            .write(json!({"method": "initialized"}))
            .await
            .is_err()
        {
            client.stop().await;
            return Err(GuiError::Startup);
        }
        Ok(client)
    }

    pub(super) async fn attach(
        app: AppHandle,
        home: PathBuf,
        projectless_root: PathBuf,
        mut server: ServerProcess,
    ) -> Result<Arc<Self>> {
        let writer = server.process.stdin.take().ok_or(GuiError::Startup)?;
        let stdout = server.process.stdout.take().ok_or(GuiError::Startup)?;
        let stderr = server.process.stderr.take().ok_or(GuiError::Startup)?;
        let gui = app.state::<crate::codex_gui::GuiState>();
        let recovery = gui
            .recovery
            .get_or_try_init(|| async {
                crate::codex_gui::recovery::Writer::open(&home)
                    .map(Arc::new)
                    .map_err(|_| GuiError::Startup)
            })
            .await?
            .clone();
        let client = Arc::new(Self {
            workspaces: gui.workspaces.clone(),
            title_jobs: Mutex::default(),
            title_writes: Mutex::default(),
            title_slots: tokio::sync::Semaphore::new(MAX_CONCURRENT_TITLE_JOBS),
            prediction_slot: tokio::sync::Semaphore::new(1),
            reviews: turn_review::ReviewQueue::new(home.clone()).map_err(|_| GuiError::Startup)?,
            recovery,
            home,
            projectless_root,
            writer: Mutex::new(writer),
            process: Mutex::new(server.process),
            pending: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            active_turns: Mutex::new(HashMap::new()),
            live_history: std::sync::Mutex::default(),
            review_starts: Mutex::default(),
            completion_notifications: Mutex::default(),
            context_capacity: context_capacity::ContextCapacity::default(),
            context_usage: Mutex::default(),
            idle_threads: idle_threads::IdleThreads::default(),
            plugin_revision: Mutex::new(None),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            events_enabled: AtomicBool::new(false),
            notification_session: uuid::Uuid::new_v4().to_string(),
            #[cfg(windows)]
            plugin_host: server.plugin_host,
            app,
        });
        tokio::spawn(client.clone().read(stdout));
        tokio::spawn(client.clone().read_context_usage(stderr));
        Ok(client)
    }
}
