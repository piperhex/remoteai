const SERVICE_TIER_BINDING: &str = "codexSwitchSetServiceTier";
const USAGE_SUMMARY_BINDING: &str = "codexSwitchRequestUsageSummary";
const RENDERER_BINDING_POLL: Duration = Duration::from_millis(500);
static RENDERER_BINDING_GENERATION: AtomicU64 = AtomicU64::new(0);
static USAGE_SUMMARY_REVISION: AtomicU64 = AtomicU64::new(1);

struct RendererBindingCall {
    name: String,
    payload: String,
}

impl CdpSession {
    fn read_renderer_binding(&mut self) -> Result<Option<RendererBindingCall>, String> {
        if let Some(call) = self.pending_bindings.pop_front() {
            return Ok(Some(call));
        }
        let deadline = Instant::now() + RENDERER_BINDING_POLL;
        loop {
            // Unrelated renderer events must not starve usage-change publication.
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            self.socket
                .get_mut()
                .set_read_timeout(Some(remaining))
                .map_err(|error| format!("Failed to configure CDP binding timeout: {error}"))?;
            let message = match self.socket.read() {
                Ok(message) => message,
                Err(tungstenite::Error::Io(error))
                    if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) =>
                {
                    return Ok(None);
                }
                Err(error) => return Err(format!("Failed to read CDP binding event: {error}")),
            };
            let Message::Text(text) = message else {
                continue;
            };
            let value: Value = serde_json::from_str(text.as_str())
                .map_err(|error| format!("Invalid CDP binding event: {error}"))?;
            let Some(call) = renderer_binding_call(&value) else {
                continue;
            };
            return Ok(Some(call));
        }
    }
}

fn renderer_binding_call(value: &Value) -> Option<RendererBindingCall> {
    if value.get("method").and_then(Value::as_str) != Some("Runtime.bindingCalled") {
        return None;
    }
    let params = value.get("params")?;
    let name = params.get("name")?.as_str()?;
    if !matches!(name, SERVICE_TIER_BINDING | USAGE_SUMMARY_BINDING) {
        return None;
    }
    Some(RendererBindingCall {
        name: name.to_string(),
        payload: params.get("payload")?.as_str()?.to_string(),
    })
}

fn evaluate_for_binding(target: &CdpTarget, port: u16, expression: &str) -> Result<Value, String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    session.evaluate(expression)
}

fn acknowledge_service_tier(target: &CdpTarget, port: u16, tier: &str, succeeded: bool) {
    let Ok(tier) = serde_json::to_string(tier) else {
        return;
    };
    let expression =
        format!("window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeSelection?.({tier}, {succeeded})");
    let _ = evaluate_for_binding(target, port, &expression);
}

fn publish_usage_summary(target: &CdpTarget, port: u16) {
    if let Err(error) = load_and_publish_usage_summary(target, port) {
        eprintln!("Failed to publish the Codex usage summary: {error}");
        complete_usage_request(target, port);
    }
}

fn load_and_publish_usage_summary(target: &CdpTarget, port: u16) -> Result<(), String> {
    let app = crate::codex_runtime::runtime_app_handle()
        .ok_or_else(|| "Codex runtime is not initialized.".to_string())?;
    let settings = crate::storage::read_app_settings(&app)?;
    publish_usage_with_language(target, port, settings.language.as_deref(), || {
        crate::codex_usage_summary::load(&app, &settings)
    })
}

fn publish_usage_with_language(
    target: &CdpTarget,
    port: u16,
    language: Option<&str>,
    load_summary: impl FnOnce() -> Result<crate::codex_usage_summary::CodexUsageSummary, String>,
) -> Result<(), String> {
    // Preferences must reach the renderer before accounting I/O can block or fail.
    let language = serde_json::to_string(&language).map_err(|error| error.to_string())?;
    let expression = format!("window.__CODEX_SWITCH_SPEED_SELECTOR__?.updateLanguage?.({language})");
    evaluate_for_binding(target, port, &expression)?;
    let summary = load_summary()?;
    let summary = serde_json::to_string(&summary).map_err(|error| error.to_string())?;
    let expression = format!("window.__CODEX_SWITCH_SPEED_SELECTOR__?.updateUsage?.({summary})");
    evaluate_for_binding(target, port, &expression)?;
    Ok(())
}

fn complete_usage_request(target: &CdpTarget, port: u16) {
    let expression = "window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeUsageRequest?.(); true";
    if let Err(error) = evaluate_for_binding(target, port, expression) {
        eprintln!("Failed to acknowledge the Codex usage request: {error}");
    }
}

fn handle_renderer_binding(call: RendererBindingCall, target: &CdpTarget, port: u16) {
    if call.name == USAGE_SUMMARY_BINDING {
        publish_usage_summary(target, port);
        return;
    }
    let succeeded = crate::local_proxy::is_running()
        && crate::local_proxy::set_proxy_service_tier_by_name(&call.payload);
    acknowledge_service_tier(target, port, &call.payload, succeeded);
    if succeeded {
        crate::codex_runtime::notify_service_tier_changed();
    }
}

fn run_renderer_bindings(mut session: CdpSession, target: CdpTarget, port: u16, generation: u64) {
    let mut published_revision = 0;
    while RENDERER_BINDING_GENERATION.load(Ordering::Acquire) == generation {
        let call = match session.read_renderer_binding() {
            Ok(call) => call,
            Err(error) => {
                eprintln!("Codex renderer bindings stopped: {error}");
                return;
            }
        };
        if RENDERER_BINDING_GENERATION.load(Ordering::Acquire) != generation {
            return;
        }
        let revision = USAGE_SUMMARY_REVISION.load(Ordering::Acquire);
        let requested_usage = call.as_ref().is_some_and(|call| call.name == USAGE_SUMMARY_BINDING);
        if let Some(call) = call {
            handle_renderer_binding(call, &target, port);
        }
        // Coalesce concurrent writes, including changes that arrive during a slow query.
        if requested_usage || published_revision != revision {
            if !requested_usage {
                publish_usage_summary(&target, port);
            }
            published_revision = revision;
        }
    }
}

fn install_renderer_bindings(target: &CdpTarget, port: u16) -> Result<(), String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    session.add_binding(SERVICE_TIER_BINDING)?;
    session.add_binding(USAGE_SUMMARY_BINDING)?;
    session.evaluate(
        "setTimeout(() => { \
            window.__CODEX_SWITCH_SPEED_SELECTOR__?.completeUsageRequest?.(); \
            window.__CODEX_SWITCH_SPEED_SELECTOR__?.requestUsage?.(); \
        }, 0); true",
    )?;
    let target = target.clone();
    let (ready, activation) = std::sync::mpsc::sync_channel(1);
    thread::Builder::new()
        .name("codex-renderer-bindings".to_string())
        .spawn(move || {
            if let Ok(generation) = activation.recv() {
                run_renderer_bindings(session, target, port, generation);
            }
        })
        .map_err(|error| format!("Failed to start the Codex renderer bindings: {error}"))?;
    // Keep the previous listener alive until the replacement is fully initialized
    // and its worker exists. The worker waits for this generation before reading.
    let generation = RENDERER_BINDING_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    ready
        .send(generation)
        .map_err(|_| "Failed to activate the Codex renderer bindings.".to_string())
}

/// Signals the existing background listener without I/O or a thread per completed request.
pub(crate) fn notify_usage_summary_changed() {
    USAGE_SUMMARY_REVISION.fetch_add(1, Ordering::AcqRel);
}
