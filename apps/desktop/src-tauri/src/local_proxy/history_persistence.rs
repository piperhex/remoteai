//! All session writes share one worker and take their snapshot after the database lock.
//! Thus a delayed first-token invalidation cannot overwrite a completed request.
use super::{
    history_writer::{Key, RequestLease, Work, Writer},
    *,
};

pub(super) static WRITER: OnceLock<Writer> = OnceLock::new();
pub(super) static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
thread_local! {
    pub(super) static TEST_WRITER: std::cell::RefCell<Option<Arc<Writer>>> = const { std::cell::RefCell::new(None) };
}

pub(super) fn with_writer<T>(action: impl FnOnce(Option<&Writer>) -> T) -> T {
    #[cfg(test)]
    if let Some(writer) = TEST_WRITER.with(|current| current.borrow().clone()) {
        return action(Some(&writer));
    }
    action(WRITER.get())
}
static ADMISSION: Mutex<()> = Mutex::new(());
const RETENTION_WAIT: Duration = Duration::from_secs(2);
const EXIT_WAIT: Duration = Duration::from_secs(15);

pub(super) fn start(store: Arc<ProxyHistoryStore>) -> ProxyHistoryResult<()> {
    let writer = Writer::start(
        move |work| save(&store, work),
        |error| {
            PROXY_HISTORY_SAVE_FAILED.store(true, Ordering::Release);
            match error {
                Some(error) => eprintln!("proxy history writer failed: {error:?}"),
                None => eprintln!("proxy history writer panicked"),
            }
            log_proxy_error!("{}", history_error_message(ProxyHistoryError::Lock));
        },
    )?;
    WRITER.set(writer).map_err(|_| ProxyHistoryError::Lock)
}

pub(super) fn save(store: &ProxyHistoryStore, work: &Work) -> ProxyHistoryResult<()> {
    match work {
        Work::Save(key) => {
            store.save_with(|| capture_proxy_history_snapshot(&key.session, key.request))
        }
        Work::Rescan => rescan(store),
    }
}

fn rescan(store: &ProxyHistoryStore) -> ProxyHistoryResult<()> {
    let mut after = None;
    loop {
        let next = proxy_sessions()
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?
            .keys()
            .filter(|id| after.as_ref().is_none_or(|previous| *id > previous))
            .min()
            .cloned();
        let Some(session) = next else { return Ok(()) };
        save(
            store,
            &Work::Save(Key {
                session: session.clone(),
                request: None,
            }),
        )?;
        rescan_requests(store, &session)?;
        after = Some(session);
    }
}

fn rescan_requests(store: &ProxyHistoryStore, session: &str) -> ProxyHistoryResult<()> {
    let mut after = 0;
    loop {
        let next = proxy_sessions()
            .lock()
            .map_err(|_| ProxyHistoryError::Lock)?
            .get(session)
            .and_then(|state| {
                state
                    .requests
                    .iter()
                    .map(|request| request.id)
                    .filter(|id| *id > after)
                    .min()
            });
        let Some(request) = next else { return Ok(()) };
        save(
            store,
            &Work::Save(Key {
                session: session.into(),
                request: Some(request),
            }),
        )?;
        after = request;
    }
}

pub(super) fn enter() -> Result<Option<RequestLease>, String> {
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        return Err(history_error_message(ProxyHistoryError::Lock));
    }
    with_writer(|writer| writer.map(Writer::enter).transpose()).map_err(|error| {
        eprintln!("proxy history admission: {error}");
        history_error_message(ProxyHistoryError::Lock)
    })
}

/// Serialize only request creation. At the retention limit, backpressure happens
/// before upstream work; readers and finalization never acquire this lock.
pub(super) fn begin(request: ProxySessionRequest<'_>) -> Result<ProxySessionRequestGuard, String> {
    let _admission = ADMISSION
        .lock()
        .map_err(|_| history_error_message(ProxyHistoryError::Lock))?;
    let id = proxy_session_id(request.headers)
        .unwrap_or_else(|| unidentified_proxy_session_id(request.remote_address.as_deref()));
    prepare_eviction(&id).map_err(history_error_message)?;
    Ok(begin_proxy_session_request(
        request.headers,
        request.remote_address,
        request.body,
        request.service_tier,
    ))
}

fn prepare_eviction(id: &str) -> ProxyHistoryResult<()> {
    let oldest = proxy_sessions()
        .lock()
        .map_err(|_| ProxyHistoryError::Lock)?
        .get(id)
        .filter(|session| session.requests.len() >= PROXY_SESSION_REQUEST_KEEP_ROWS)
        .and_then(|session| session.requests.front())
        .map(|request| (request.id, request.response_time_ms));
    let Some((request, finished)) = oldest else {
        return Ok(());
    };
    // Never evict a live request, even if an earlier snapshot already reached disk.
    if finished.is_none() {
        return Err(ProxyHistoryError::Lock);
    }
    with_writer(|writer| {
        if let Some(writer) = writer {
            writer
                .enqueue(id, Some(request))
                .map_err(|_| ProxyHistoryError::Lock)?;
            writer
                .flush(RETENTION_WAIT)
                .map_err(|_| ProxyHistoryError::Lock)?;
        }
        Ok(())
    })
}

/// Called only by the existing blocking exit worker, including headless mode.
/// A failed drain cancels this exit; pending state remains available for retry.
pub(crate) fn shutdown() -> bool {
    SHUTTING_DOWN.store(true, Ordering::Release);
    // Serialize against lazy initialization before deciding there is nothing to drain.
    let Ok(_initialization) = PROXY_HISTORY_INITIALIZATION.lock() else {
        PROXY_HISTORY_SAVE_FAILED.store(true, Ordering::Release);
        SHUTTING_DOWN.store(false, Ordering::Release);
        return false;
    };
    let Some(writer) = WRITER.get() else {
        return true;
    };
    match writer.close(EXIT_WAIT) {
        Ok(()) => true,
        Err(error) => {
            SHUTTING_DOWN.store(false, Ordering::Release);
            PROXY_HISTORY_SAVE_FAILED.store(true, Ordering::Release);
            eprintln!("proxy history exit cancelled: {error}");
            log_proxy_error!("{}", history_error_message(ProxyHistoryError::Lock));
            false
        }
    }
}
