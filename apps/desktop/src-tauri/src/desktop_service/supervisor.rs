use super::{configuration, platform, process, Result, ServiceError, NAME};
use crate::remote_desktop::service_worker::{Call, Reply};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use std::{ffi::OsString, os::windows::io::AsRawHandle, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::NamedPipeServer,
    sync::watch,
};
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

define_windows_service!(service_entry, service_main);
pub(super) fn dispatch() -> Result<()> {
    if !platform::is_system()? {
        return Err(ServiceError::Denied);
    }
    service_dispatcher::start(NAME, service_entry).map_err(|_| ServiceError::Unavailable)
}
fn status(state: ServiceState, failed: bool) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: ServiceExitCode::Win32(u32::from(failed)),
        checkpoint: 0,
        wait_hint: Duration::from_secs(20),
        process_id: None,
    }
}
fn service_main(_: Vec<OsString>) {
    let (stop, shutdown) = watch::channel(false);
    let Ok(handle) = service_control_handler::register(NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            stop.send_replace(true);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    }) else {
        return;
    };
    let result: Result<()> = (|| {
        handle
            .set_service_status(status(ServiceState::StartPending, false))
            .map_err(|_| ServiceError::Unavailable)?;
        configuration::read()?;
        super::assets::verify(&configuration::install_root()?)?;
        handle
            .set_service_status(status(ServiceState::Running, false))
            .map_err(|_| ServiceError::Unavailable)?;
        tauri::async_runtime::block_on(run(shutdown))
    })();
    if handle
        .set_service_status(status(ServiceState::Stopped, result.is_err()))
        .is_err()
    {
        eprintln!("desktop service status unavailable");
    }
}

struct Worker {
    process: process::WorkerProcess,
    pipe: BufReader<NamedPipeServer>,
}
static WORKER: tokio::sync::Mutex<Option<Worker>> = tokio::sync::Mutex::const_new(None);
static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
impl Worker {
    async fn open(session: u32) -> Result<Self> {
        let name = format!(r"\\.\pipe\codex-switch-desktop-{}", uuid::Uuid::new_v4());
        let pipe = platform::private_pipe(&name)?;
        let process = process::spawn(session, &name)?;
        tokio::time::timeout(Duration::from_secs(15), pipe.connect())
            .await
            .map_err(|_| ServiceError::Unavailable)?
            .map_err(|_| ServiceError::Unavailable)?;
        let mut pid = 0;
        // SAFETY: the connected pipe and output PID are live, and only our newly created child is accepted.
        if unsafe {
            windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId(
                pipe.as_raw_handle(),
                &mut pid,
            )
        } == 0
            || pid != process.id
        {
            return Err(ServiceError::Denied);
        }
        Ok(Self {
            process,
            pipe: BufReader::new(pipe),
        })
    }
    async fn request(&mut self, call: &Call) -> Result<Reply> {
        let value = json!({"id":call.id,"command":call.command,"args":call.args});
        let mut bytes = serde_json::to_vec(&value).map_err(|_| ServiceError::Invalid)?;
        bytes.push(b'\n');
        self.pipe
            .get_mut()
            .write_all(&bytes)
            .await
            .map_err(|_| ServiceError::Unavailable)?;
        let mut line = String::new();
        let length = (&mut self.pipe)
            .take(1024 * 1024 + 1)
            .read_line(&mut line)
            .await
            .map_err(|_| ServiceError::Unavailable)?;
        if length > 1024 * 1024 || !line.ends_with('\n') {
            return Err(ServiceError::Invalid);
        }
        serde_json::from_str(&line).map_err(|_| ServiceError::Invalid)
    }
}

async fn run(mut stop: watch::Receiver<bool>) -> Result<()> {
    configuration::read()?;
    RUNNING.store(true, std::sync::atomic::Ordering::SeqCst);
    let mut control = tauri::async_runtime::spawn(super::control::serve());
    let result = loop {
        if *stop.borrow() {
            break Ok(());
        }
        tokio::select! {
            _ = &mut control => break Err(ServiceError::Unavailable),
            result = host(&mut stop) => {
                if result.is_err() { eprintln!("desktop service host restarting"); }
            }
        }
        if *stop.borrow() {
            break Ok(());
        }
        tokio::select! {
            _ = &mut control => break Err(ServiceError::Unavailable),
            _ = stop.changed() => {},
            _ = tokio::time::sleep(Duration::from_secs(3)) => {},
        }
    };
    RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    reset_worker().await;
    control.abort();
    result
}

fn start_node() -> Result<tokio::process::Child> {
    let root = configuration::install_root()?;
    let runtime = root.join("resources/desktop-service");
    tokio::process::Command::new(runtime.join("node.exe"))
        .arg(runtime.join("host.mjs"))
        .current_dir(&root)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("NODE_EXTRA_CA_CERTS")
        .env_remove("NODE_TLS_REJECT_UNAUTHORIZED")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|_| ServiceError::Unavailable)
}

async fn host(stop: &mut watch::Receiver<bool>) -> Result<()> {
    let _connectivity = super::connectivity::Lifetime;
    let config = configuration::read()?;
    let mut node = start_node()?;
    let _job = process::contain(node.raw_handle().ok_or(ServiceError::Unavailable)?)?;
    let mut output = node.stdin.take().ok_or(ServiceError::Unavailable)?;
    let mut input = BufReader::new(node.stdout.take().ok_or(ServiceError::Unavailable)?);
    let mut wire = super::framing::Frames::default();
    let mut tick = tokio::time::interval(Duration::from_secs(2));
    loop {
        let mut chunk = [0u8; 8192];
        let count = tokio::select! {
            _=stop.changed()=>{ break; },
            _=tick.tick()=>{
                let changed=WORKER.lock().await.as_ref().is_some_and(|worker|Some(worker.process.session)!=platform::console_session());
                if changed { reset_worker().await; }
                continue;
            },
            result=input.read(&mut chunk)=>result.map_err(|_|ServiceError::Unavailable)?,
        };
        if count == 0 {
            break;
        }
        wire.append(&chunk[..count])?;
        while let Some(call) = wire.next()? {
            let reply = reply(call, &config).await;
            let mut bytes = serde_json::to_vec(&reply).map_err(|_| ServiceError::Invalid)?;
            bytes.push(b'\n');
            output
                .write_all(&bytes)
                .await
                .map_err(|_| ServiceError::Unavailable)?;
        }
    }
    if let Err(error) = node.kill().await {
        if error.kind() != std::io::ErrorKind::InvalidInput {
            return Err(ServiceError::Unavailable);
        }
    }
    Ok(())
}

async fn reply(call: Call, config: &configuration::Configuration) -> Reply {
    let id = call.id;
    match handle(call, config).await {
        Ok(data) => Reply {
            id,
            data: Some(data),
            error: None,
        },
        Err(error) => Reply {
            id,
            data: None,
            error: Some(error.to_string()),
        },
    }
}

async fn handle(call: Call, config: &configuration::Configuration) -> Result<Value> {
    if call.command == "service_configuration" {
        return Ok(
            json!({"baseUrl":config.base_url,"credential":config.credential,"deviceId":config.device_id,
            "name":config.name,"version":config.version}),
        );
    }
    if call.command == "service_sign" {
        return signature(config, &call.args);
    }
    if call.command == "service_native_path" {
        return super::connectivity::call(call.args).await;
    }
    desktop_call(call).await
}

pub(super) async fn reset_worker() {
    let mut guard = WORKER.lock().await;
    if let Some(mut worker) = guard.take() {
        let closing = Call {
            id: u64::MAX,
            command: "remote_desktop_worker_close".into(),
            args: Value::Null,
        };
        // A responsive worker releases held input before its job closes; a crashed worker still gets reaped.
        if !matches!(
            tokio::time::timeout(Duration::from_secs(3), worker.request(&closing)).await,
            Ok(Ok(_))
        ) {
            eprintln!("desktop worker stopped without cleanup acknowledgement");
        }
    }
}
pub(super) async fn desktop_call(call: Call) -> Result<Value> {
    if !matches!(
        call.command.as_str(),
        "remote_desktop_open"
            | "remote_desktop_renew"
            | "remote_desktop_stream_available"
            | "remote_desktop_stream_open"
            | "remote_desktop_stream_signal"
            | "remote_desktop_stream_update"
            | "remote_desktop_stream_status"
            | "remote_desktop_privacy"
            | "remote_desktop_stream_close"
            | "remote_desktop_close"
    ) {
        return Err(ServiceError::Denied);
    }
    let mut worker = WORKER.lock().await;
    if !RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(ServiceError::Unavailable);
    }
    if worker.is_none() {
        *worker = Some(
            Worker::open(platform::console_session().ok_or(ServiceError::Unavailable)?).await?,
        );
    }
    let result = tokio::time::timeout(
        Duration::from_secs(20),
        worker
            .as_mut()
            .ok_or(ServiceError::Unavailable)?
            .request(&call),
    )
    .await;
    match result {
        Ok(Ok(reply)) if reply.id == call.id => match reply.error {
            Some(error) => Err(ServiceError::Remote(error)),
            None => Ok(reply.data.unwrap_or(Value::Null)),
        },
        _ => {
            *worker = None;
            Err(ServiceError::Unavailable)
        }
    }
}
fn signature(config: &configuration::Configuration, args: &Value) -> Result<Value> {
    let session = args["sessionId"].as_str().ok_or(ServiceError::Invalid)?;
    let ephemeral = args["publicKey"].as_str().ok_or(ServiceError::Invalid)?;
    if session.is_empty()
        || session.len() > 128
        || !session
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        || ephemeral.len() != 64
        || !ephemeral.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(ServiceError::Invalid);
    }
    let secret: [u8; 32] = STANDARD
        .decode(&config.identity_secret)
        .map_err(|_| ServiceError::Invalid)?
        .try_into()
        .map_err(|_| ServiceError::Invalid)?;
    let key = SigningKey::from_bytes(&secret);
    let context = format!("codex-switch-host-v1:{session}:{ephemeral}");
    let hex = |bytes: &[u8]| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    };
    Ok(
        json!({"key":hex(key.verifying_key().as_bytes()),"signature":hex(&key.sign(context.as_bytes()).to_bytes())}),
    )
}
