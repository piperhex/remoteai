//! Small JSON ABI for React Native. Calls run on native workers, never the platform UI thread.
use std::{
    collections::HashMap,
    ffi::{c_char, CStr, CString},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::runtime::Runtime;

use crate::{Config, Connection, Error, Result};

const MAX_HANDLES: usize = 8;
const MAX_REQUEST: usize = 256 * 1024;

#[path = "ffi_bulk.rs"]
pub(crate) mod bulk;

struct Hub {
    runtime: Runtime,
    handles: Mutex<HashMap<String, OwnedConnection>>,
    browser_proxies: Mutex<HashMap<String, crate::browser_mapping::BrowserMappingProxy>>,
}
struct OwnedConnection {
    owner: String,
    session: String,
    connection: Arc<Connection>,
}
static HUB: OnceLock<std::result::Result<Hub, Error>> = OnceLock::new();
static NEXT_HANDLE: AtomicU64 = AtomicU64::new(1);

pub(crate) fn reset() -> Result<()> {
    let Some(Ok(hub)) = HUB.get() else {
        return Ok(());
    };
    for (_, entry) in hub.handles.lock().map_err(|_| Error::Closed)?.drain() {
        entry.connection.close();
    }
    hub.browser_proxies
        .lock()
        .map_err(|_| Error::Closed)?
        .clear();
    Ok(())
}

fn hub() -> Result<&'static Hub> {
    HUB.get_or_init(|| {
        Ok(Hub {
            runtime: tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .map_err(Error::Io)?,
            handles: Mutex::default(),
            browser_proxies: Mutex::default(),
        })
    })
    .as_ref()
    .map_err(|_| Error::Unavailable)
}

#[derive(Deserialize)]
struct Request {
    #[serde(default)]
    owner: String,
    #[serde(flatten)]
    operation: Operation,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case")]
enum Operation {
    Open {
        config: Config,
        #[serde(default)]
        bulk: bool,
        #[serde(default)]
        packets: bool,
    },
    Send {
        id: String,
        text: String,
    },
    BulkSend {
        id: String,
        generation: u64,
        data: String,
    },
    BulkPoll {
        id: String,
    },
    Poll {
        id: String,
        wait_ms: Option<u64>,
    },
    Close {
        id: String,
    },
    Renew {
        id: String,
        expires_at: u64,
    },
    MediaOpen {
        id: String,
        view_id: String,
    },
    MediaStatus {
        id: String,
        view_id: String,
    },
    MediaClose {
        id: String,
        view_id: String,
    },
    Reset,
    Addresses,
    BrowserMappings {
        routes: std::collections::BTreeSet<crate::browser_mapping::BrowserRoute>,
    },
    PacketCodec {
        request: crate::packet_codec::Request,
    },
}

fn dispatch(request: Request) -> Result<Value> {
    if request.owner.len() > 128 {
        return Err(Error::Invalid);
    }
    // Codec work must not initialize networking or compete with session/poll locks.
    if let Operation::PacketCodec { request } = request.operation {
        return crate::packet_codec::transform(request)
            .map(Value::String)
            .map_err(|_| Error::Invalid);
    }
    let hub = hub()?;
    match request.operation {
        Operation::PacketCodec { .. } => Err(Error::Invalid),
        Operation::Open {
            config,
            bulk,
            packets,
        } => open(hub, request.owner, (config, bulk, packets)),
        Operation::Close { id } => {
            if let Some(entry) = hub.handles.lock().map_err(|_| Error::Closed)?.remove(&id) {
                entry.connection.close();
            }
            Ok(Value::Null)
        }
        Operation::Send { id, text } => {
            hub.runtime.block_on(connection(hub, &id)?.send(text))?;
            Ok(Value::Null)
        }
        Operation::BulkSend {
            id,
            generation,
            data,
        } => {
            bulk::send_encoded(&request.owner, &id, generation, &data)?;
            Ok(Value::Null)
        }
        Operation::BulkPoll { id } => bulk::poll(&request.owner, &id),
        Operation::Renew { id, expires_at } => {
            connection(hub, &id)?.renew(expires_at)?;
            Ok(Value::Null)
        }
        Operation::Reset => {
            hub.browser_proxies
                .lock()
                .map_err(|_| Error::Closed)?
                .remove(&request.owner);
            hub.handles
                .lock()
                .map_err(|_| Error::Closed)?
                .retain(|_, entry| {
                    if entry.owner != request.owner {
                        return true;
                    }
                    entry.connection.close();
                    false
                });
            Ok(Value::Null)
        }
        Operation::Poll { id, wait_ms } => poll(hub, &id, wait_ms),
        Operation::Addresses => Ok(json!(crate::local_addresses()?)),
        Operation::BrowserMappings { routes } => {
            // Mobile browser routes refer exclusively to listeners owned by the mobile mapping service.
            if routes.iter().any(|r| {
                r.target.is_some() || r.domain == "localhost" || r.domain.ends_with(".localhost")
            }) {
                return Err(Error::Invalid);
            }
            let mut proxies = hub.browser_proxies.lock().map_err(|_| Error::Closed)?;
            if routes.is_empty() {
                proxies.remove(&request.owner);
                return Ok(Value::Null);
            }
            if let Some(proxy) = proxies.get(&request.owner) {
                proxy.configure(routes)?;
                return Ok(json!(proxy.port()));
            }
            let proxy = hub
                .runtime
                .block_on(crate::browser_mapping::BrowserMappingProxy::start(routes))?;
            let port = proxy.port();
            proxies.insert(request.owner, proxy);
            Ok(json!(port))
        }
        Operation::MediaOpen { id, view_id } => Ok(json!(hub
            .runtime
            .block_on(owned_connection(hub, &id, &request.owner)?.open_media(&view_id))?)),
        Operation::MediaStatus { id, view_id } => Ok(json!(hub
            .runtime
            .block_on(owned_connection(hub, &id, &request.owner)?.media_status(&view_id))?)),
        Operation::MediaClose { id, view_id } => {
            hub.runtime
                .block_on(owned_connection(hub, &id, &request.owner)?.close_media(&view_id));
            Ok(Value::Null)
        }
    }
}

fn open(hub: &Hub, owner: String, input: (Config, bool, bool)) -> Result<Value> {
    let (config, bulk, packets) = input;
    if packets && (bulk || !config.session_id.starts_with("update-")) {
        return Err(Error::Invalid);
    }
    let mut handles = hub.handles.lock().map_err(|_| Error::Closed)?;
    handles.retain(|_, entry| !entry.connection.is_closed());
    if handles.len() >= MAX_HANDLES
        || handles
            .values()
            .any(|entry| entry.owner == owner && entry.session == config.session_id)
    {
        return Err(Error::Closed);
    }
    // A late close from a replaced bridge must never close a new instance of the same session.
    let id = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed).to_string();
    let _entered = hub.runtime.enter();
    let entry = OwnedConnection {
        owner,
        session: config.session_id.clone(),
        connection: if packets {
            Connection::start_with_packets(config)?
        } else {
            Connection::start_with_bulk(config, bulk)?
        },
    };
    handles.insert(id.clone(), entry);
    Ok(json!(id))
}

fn poll(hub: &Hub, id: &str, wait_ms: Option<u64>) -> Result<Value> {
    let connection = connection(hub, id)?;
    let event = hub.runtime.block_on(async {
        match tokio::time::timeout(
            Duration::from_millis(wait_ms.unwrap_or(250).min(250)),
            connection.receive(),
        )
        .await
        {
            Ok(event) => Some(event.unwrap_or(crate::Event::Closed)),
            Err(_) => None,
        }
    });
    serde_json::to_value(event).map_err(|_| Error::Invalid)
}

fn connection(hub: &Hub, id: &str) -> Result<Arc<Connection>> {
    hub.handles
        .lock()
        .map_err(|_| Error::Closed)?
        .get(id)
        .map(|entry| entry.connection.clone())
        .ok_or(Error::Closed)
}

fn owned_connection(hub: &Hub, id: &str, owner: &str) -> Result<Arc<Connection>> {
    hub.handles
        .lock()
        .map_err(|_| Error::Closed)?
        .get(id)
        .filter(|entry| entry.owner == owner)
        .map(|entry| entry.connection.clone())
        .ok_or(Error::Closed)
}

/// Android calls this on a dedicated native worker. Empty means timeout; None means closed.
#[cfg(target_os = "android")]
pub(crate) fn receive_bulk(owner: &str, id: &str) -> Result<Option<Vec<u8>>> {
    let hub = hub()?;
    let connection = owned_connection(hub, id, owner)?;
    Ok(hub.runtime.block_on(async {
        tokio::time::timeout(Duration::from_millis(250), connection.receive_bulk())
            .await
            .unwrap_or_else(|_| Some(Vec::new()))
    }))
}

#[cfg(target_os = "android")]
pub(crate) fn receive_packet(owner: &str, id: &str) -> Result<Option<Vec<u8>>> {
    let hub = hub()?;
    let connection = owned_connection(hub, id, owner)?;
    Ok(hub.runtime.block_on(async {
        tokio::time::timeout(Duration::from_millis(250), connection.receive_packet())
            .await
            .unwrap_or_else(|_| Some(Vec::new()))
    }))
}

pub(crate) fn call(request: &str) -> String {
    let result = std::panic::catch_unwind(|| {
        if request.len() > MAX_REQUEST {
            return Err(Error::Invalid);
        }
        dispatch(serde_json::from_str(request).map_err(|_| Error::Invalid)?)
    });
    match result {
        Ok(Ok(value)) => json!({ "data": value }).to_string(),
        _ => "{\"error\":\"Connection unavailable\"}".into(),
    }
}

/// Returns an owned UTF-8 JSON response; release it with `csw_connectivity_free`.
///
/// # Safety
/// `request` must reference a readable, NUL-terminated UTF-8 string for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn csw_connectivity_call(request: *const c_char) -> *mut c_char {
    if request.is_null() {
        return std::ptr::null_mut();
    }
    // The embedding native bridge owns the input string until this synchronous call returns.
    let request = unsafe { CStr::from_ptr(request) };
    let reply = request
        .to_str()
        .map(call)
        .unwrap_or_else(|_| "{\"error\":\"Invalid request\"}".into());
    CString::new(reply)
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// `response` must be null or an unfreed pointer returned by `csw_connectivity_call`.
#[no_mangle]
pub unsafe extern "C" fn csw_connectivity_free(response: *mut c_char) {
    if !response.is_null() {
        // Ownership of this exact allocation was transferred to the caller by into_raw above.
        drop(unsafe { CString::from_raw(response) });
    }
}
