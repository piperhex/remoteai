use crate::service::{Request, Service};
use csw_ssh_client::{Error, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    ffi::{c_char, CStr, CString},
    sync::OnceLock,
};
use tokio::runtime::Runtime;

const MAX_REQUEST: usize = 8 * 1024 * 1024;
static HUB: OnceLock<Result<Hub>> = OnceLock::new();
struct Hub {
    runtime: Runtime,
    service: Service,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    owner: String,
    scope: Option<String>,
    request: Option<Request>,
    #[serde(default)]
    reset: bool,
}

fn dispatch(input: &str) -> Result<Value> {
    if input.len() > MAX_REQUEST {
        return Err(Error::Invalid);
    }
    let input: Envelope = serde_json::from_str(input).map_err(|_| Error::Invalid)?;
    if input.owner.is_empty() || input.owner.len() > 128 {
        return Err(Error::Invalid);
    }
    let hub = HUB
        .get_or_init(|| {
            Ok(Hub {
                runtime: tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .map_err(|_| Error::Connection)?,
                service: Service::default(),
            })
        })
        .as_ref()
        .map_err(|_| Error::Connection)?;
    if input.reset {
        hub.runtime.block_on(hub.service.reset(&input.owner))?;
        return Ok(Value::Null);
    }
    hub.runtime.block_on(hub.service.dispatch(
        &input.owner,
        &input.scope.ok_or(Error::Invalid)?,
        input.request.ok_or(Error::Invalid)?,
    ))
}

/// Invoke on a platform worker. Replies contain only stable, localized SSH error keys.
pub fn bridge_call(input: &str) -> String {
    match dispatch(input) {
        Ok(data) => json!({ "data": data }).to_string(),
        Err(error) => json!({ "error": error.to_string() }).to_string(),
    }
}

/// # Safety
/// `input` must point to a valid NUL-terminated UTF-8 string for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn csw_ssh_call(input: *const c_char) -> *mut c_char {
    if input.is_null() {
        return std::ptr::null_mut();
    }
    // SAFETY: the native bridge holds its UTF-8 NSString buffer until this synchronous call returns.
    let input = unsafe { CStr::from_ptr(input) };
    let Ok(input) = input.to_str() else {
        return std::ptr::null_mut();
    };
    CString::new(bridge_call(input)).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// # Safety
/// `reply` must be a live pointer returned by `csw_ssh_call`, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn csw_ssh_free(reply: *mut c_char) {
    if !reply.is_null() {
        // SAFETY: ownership of this allocation returns from the native bridge exactly once.
        drop(unsafe { CString::from_raw(reply) });
    }
}
