const MISSING_INPUT_TOKENS_FLAG: &str = "input_tokens_missing";
const MISSING_OUTPUT_TOKENS_FLAG: &str = "output_tokens_missing";
const INCOMPLETE_USAGE_FLAG: &str = "usage_incomplete";

use lan_usage_capture::{LanUsageAccounting, LanUsageCapture};

fn attach_token_usage_capture<R: Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    context: Option<TokenUsageContext>,
    result: Result<UpstreamPayload, String>,
) -> Result<UpstreamPayload, String> {
    let mut payload = result?;
    let Some(mut context) = context else {
        return Ok(payload);
    };
    if !status_ok(payload.status) {
        update_proxy_session_response_account(&mut context, &payload);
        return Ok(payload);
    }
    context.service_tier = UsageServiceTier::new(
        payload.token_usage_service_tier.clone(),
        payload.token_usage_account.is_some(),
    );
    if context.provider_id.is_none() && payload.token_usage_account.is_none() {
        if let Ok(paths) = resolve_paths(app) {
            if let Some(provider_id) = read_state(&paths).active_provider_id {
                if let Ok(provider) = providers::read_provider(&paths, &provider_id) {
                    context.provider = provider.name.clone();
                    context.provider_id = Some(provider.id.clone());
                    if !provider.model_selection_controlled_by_codex
                        || !provider.models.iter().any(|model| model == &context.model)
                    {
                        context.model = provider.model.clone();
                    }
                    update_proxy_session_target(
                        context.session_id.as_deref(),
                        context.session_request_id,
                        &context.provider,
                        &context.model,
                    );
                }
            }
        }
    }
    context.content_type = payload.content_type.clone();
    update_proxy_session_response_account(&mut context, &payload);
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            context
                .service_tier
                .observe_response(extract_service_tier_from_bytes(
                    &body,
                    context.content_type.as_deref(),
                    context.expects_event_stream,
                ));
            let usage = extract_token_usage_from_bytes(
                &body,
                context.content_type.as_deref(),
                context.expects_event_stream,
            );
            let accounting = lan_usage_capture::buffered_accounting(&body, &context);
            record_token_usage_entry(app, &context, usage, accounting);
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(reader) => UpstreamBody::Streaming(Box::new(
            TokenUsageCaptureReader::new(reader, app.clone(), context),
        )),
    };
    Ok(payload)
}

struct TokenUsageCaptureReader<R: Runtime> {
    inner: Box<dyn Read + Send>,
    app: tauri::AppHandle<R>,
    context: TokenUsageContext,
    body: Vec<u8>,
    sse_buffer: String,
    usage: Option<TokenUsageValues>,
    recorded: bool,
    complete: bool,
    lan_usage: LanUsageCapture,
}

impl<R: Runtime> TokenUsageCaptureReader<R> {
    fn new(
        inner: Box<dyn Read + Send>,
        app: tauri::AppHandle<R>,
        context: TokenUsageContext,
    ) -> Self {
        Self {
            lan_usage: LanUsageCapture::new(&context),
            inner,
            app,
            context,
            body: Vec::new(),
            sse_buffer: String::new(),
            usage: None,
            recorded: false,
            complete: false,
        }
    }

    fn observe(&mut self, bytes: &[u8]) {
        self.lan_usage.observe(bytes);
        if self.captures_event_stream() {
            let chunk = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
            self.sse_buffer.push_str(&chunk);
            self.process_sse_blocks();
            return;
        }
        let remaining = TOKEN_USAGE_CAPTURE_MAX_BYTES.saturating_sub(self.body.len());
        if remaining > 0 {
            self.body
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
    }

    fn process_sse_blocks(&mut self) {
        while let Some(index) = self.sse_buffer.find("\n\n") {
            let block = self.sse_buffer[..index].to_string();
            self.sse_buffer.drain(..index + 2);
            self.process_sse_block(&block);
        }
    }

    fn process_sse_block(&mut self, block: &str) {
        let data = block
            .lines()
            .filter_map(|line| line.trim_start().strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.trim() == "[DONE]" {
            self.complete = true;
            self.record_usage();
            return;
        }
        if data.trim().is_empty() {
            return;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            self.context
                .service_tier
                .observe_response(extract_service_tier_from_value(&value));
            merge_token_usage_event(&mut self.usage, &value);
            if is_terminal_usage_event(&value) {
                // A terminal event completes accounting even if the upstream keeps its socket open.
                self.complete = !event_usage_incomplete(&value);
                self.record_usage();
            }
        }
    }

    fn captures_event_stream(&self) -> bool {
        lan_usage_capture::captures_event_stream(&self.context)
    }

    fn finish(&mut self) {
        if self.recorded {
            return;
        }
        self.lan_usage.finish(false);
        if self.captures_event_stream() {
            self.process_sse_blocks();
            if !self.sse_buffer.trim().is_empty() {
                let block = std::mem::take(&mut self.sse_buffer);
                self.process_sse_block(&block);
            }
        } else if self.usage.is_none() {
            self.complete = buffered_usage_complete(&self.body);
            self.context
                .service_tier
                .observe_response(extract_service_tier_from_bytes(
                    &self.body,
                    self.context.content_type.as_deref(),
                    self.context.expects_event_stream,
                ));
            self.usage = extract_token_usage_from_bytes(
                &self.body,
                self.context.content_type.as_deref(),
                self.context.expects_event_stream,
            );
        }
        self.record_usage();
    }

    fn record_usage(&mut self) {
        if self.recorded {
            return;
        }
        self.recorded = true;
        record_token_usage_entry(
            &self.app,
            &self.context,
            self.usage.clone(),
            self.lan_usage.accounting(self.complete),
        );
    }
}

impl<R: Runtime> Read for TokenUsageCaptureReader<R> {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        match self.inner.read(target) {
            Ok(0) => {
                self.finish();
                Ok(0)
            }
            Ok(count) => {
                self.observe(&target[..count]);
                Ok(count)
            }
            Err(error) => {
                self.lan_usage.finish(true);
                self.finish();
                Err(error)
            }
        }
    }
}

impl<R: Runtime> Drop for TokenUsageCaptureReader<R> {
    fn drop(&mut self) {
        // A reader dropped before EOF or a terminal event represents an unfinished request.
        if !self.recorded {
            self.lan_usage.finish(true);
        }
        self.finish();
    }
}

fn extract_token_usage_from_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    expects_event_stream: bool,
) -> Option<TokenUsageValues> {
    if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
        return extract_token_usage_from_value(&value);
    }
    if expects_event_stream || is_event_stream(content_type) {
        let text = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
        let mut usage = None;
        for block in text.split("\n\n") {
            let data = block
                .lines()
                .filter_map(|line| line.trim_start().strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            if data.trim().is_empty() || data.trim() == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                merge_token_usage_event(&mut usage, &value);
            }
        }
        return usage;
    }

    None
}

fn is_terminal_usage_event(value: &Value) -> bool {
    matches!(
        value.get("type").and_then(Value::as_str),
        Some("response.completed" | "response.incomplete" | "response.failed" | "message_stop")
    )
}

fn buffered_usage_complete(body: &[u8]) -> bool {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        return !event_usage_incomplete(&value);
    }
    let mut complete = false;
    for block in String::from_utf8_lossy(body)
        .replace("\r\n", "\n")
        .split("\n\n")
    {
        let data = block
            .lines()
            .filter_map(|line| line.trim_start().strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.trim() == "[DONE]" {
            complete = true;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&data) {
            if event_usage_incomplete(&value) {
                return false;
            }
            complete |= is_terminal_usage_event(&value);
        }
    }
    complete
}

fn event_usage_incomplete(value: &Value) -> bool {
    ["/usage", "/response/usage", "/message/usage"]
        .iter()
        .any(|path| {
            value
                .pointer(path)
                .and_then(|usage| usage.get(INCOMPLETE_USAGE_FLAG))
                .and_then(Value::as_bool)
                == Some(true)
        })
}

fn extract_token_usage_from_value(value: &Value) -> Option<TokenUsageValues> {
    let usage = value
        .get("usage")
        .filter(|usage| !usage.is_null())
        .or_else(|| {
            value
                .pointer("/response/usage")
                .filter(|usage| !usage.is_null())
        })
        .or_else(|| {
            value
                .pointer("/choices/0/usage")
                .filter(|usage| !usage.is_null())
        })
        .or_else(|| {
            value
                .pointer("/message/usage")
                .filter(|usage| !usage.is_null())
        })?;
    Some(token_usage_values_from_usage(usage))
}

fn merge_token_usage_event(current: &mut Option<TokenUsageValues>, value: &Value) {
    let Some(mut next) = extract_token_usage_from_value(value) else {
        return;
    };
    if value.get("type").and_then(Value::as_str) == Some("message_delta") {
        if let Some(previous) = current.as_ref() {
            let usage = value.get("usage").unwrap_or(&Value::Null);
            if !usage_field_missing(usage, MISSING_INPUT_TOKENS_FLAG) {
                next.input_tokens = next.input_tokens.or(previous.input_tokens);
            }
            if !usage_field_missing(usage, MISSING_OUTPUT_TOKENS_FLAG) {
                next.output_tokens = next.output_tokens.or(previous.output_tokens);
            }
            next.cached_tokens = next.cached_tokens.or(previous.cached_tokens);
            next.reasoning_tokens = next.reasoning_tokens.or(previous.reasoning_tokens);
            next.total_tokens = next
                .input_tokens
                .zip(next.output_tokens)
                .map(|(input, output)| input.saturating_add(output));
        }
    }
    *current = Some(next);
}

fn record_token_usage_entry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    context: &TokenUsageContext,
    usage: Option<TokenUsageValues>,
    accounting: LanUsageAccounting,
) {
    let usage = usage.unwrap_or_default();
    if usage.total_tokens.is_some_and(|tokens| tokens > 0) {
        if let Some(account) = &context.account {
            crate::quota_window_sync::observe_activity(app, &account.account_id);
        }
    }
    let duration_ms = context.started_at.elapsed().as_millis() as u64;
    let id = short_hash_str(&format!(
        "{}:{}:{}:{}:{}:{}",
        context.ts,
        context.provider,
        context.model,
        context.request_hash,
        duration_ms,
        unix_millis()
    ));
    let entry = TokenUsageEntry {
        id,
        ts: context.ts,
        provider: context.provider.clone(),
        provider_id: context.provider_id.clone(),
        account_id: context
            .account
            .as_ref()
            .map(|account| account.account_id.clone()),
        account_email: context
            .account
            .as_ref()
            .map(|account| account.account_email.clone()),
        model: context.model.clone(),
        service_tier: context.service_tier.for_estimate().map(str::to_owned),
        duration_ms: Some(duration_ms),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        reasoning_tokens: usage.reasoning_tokens,
        cached_tokens: usage.cached_tokens,
        total_tokens: usage.total_tokens,
        model_context_window: None,
    };
    if let Err(error) = session_cost::record(app, context, &entry) {
        log_proxy_error!("failed to record conversation cost: {error}");
    }
    update_proxy_session_request_usage(
        context.session_id.as_deref(),
        context.session_request_id,
        &usage,
    );
    update_proxy_session_usage(
        context.session_id.as_deref(),
        context.account.as_ref().map(|account| account.account_id.as_str()),
        context.account.as_ref().map(|account| account.account_email.as_str()),
        Some(&usage),
    );
    let usage_complete = match accounting {
        LanUsageAccounting::Complete => Some(true),
        LanUsageAccounting::Incomplete => Some(false),
        LanUsageAccounting::Failed => None,
    };
    if let (Some(key_id), Some(usage_complete)) =
        (context.lan_api_key_id.as_deref(), usage_complete)
    {
        if let Err(error) = lan_keys::record_usage(app, key_id, &entry, usage_complete) {
            log_proxy_error!("failed to record LAN API key usage: {error}");
        }
    }
    if let Err(error) = append_token_usage_entry(app, &entry) {
        log_proxy_error!("failed to write token usage entry: {error}");
    } else {
        let _ = app.emit("token-usage-updated", ());
        crate::codex_runtime::refresh_usage_summary();
        crate::cloud::report_device_activity_after_usage(app.clone());
    }
}
