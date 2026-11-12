fn record_captured_proxy_errors(errors: Vec<error_capture::ProxyCapturedError>) {
    for error in errors {
        crate::error_logs::record_proxy_error(&error.message, error.status_code);
    }
}

fn record_discarded_proxy_attempt(result: &Result<UpstreamPayload, String>) {
    match result {
        Ok(payload) => record_retried_proxy_response(payload),
        Err(error) => crate::error_logs::record_proxy_error(error, None),
    }
}

fn record_retried_proxy_response(payload: &UpstreamPayload) {
    let UpstreamBody::Buffered(body) = &payload.body else {
        return;
    };
    let mut capture = error_capture::ErrorCapture::new(
        is_event_stream(payload.content_type.as_deref()),
        payload.status,
    );
    record_captured_proxy_errors(capture.observe(body));
    record_captured_proxy_errors(capture.finish());
}

fn attach_proxy_error_capture(mut payload: UpstreamPayload, endpoint: &str) -> UpstreamPayload {
    let mut capture = error_capture::ErrorCapture::new(
        is_event_stream(payload.content_type.as_deref()),
        payload.status,
    )
    .for_endpoint(endpoint);
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            record_captured_proxy_errors(capture.observe(&body));
            record_captured_proxy_errors(capture.finish());
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(inner) => {
            UpstreamBody::Streaming(Box::new(ProxyErrorCaptureReader { inner, capture }))
        }
    };
    payload
}

struct ProxyErrorCaptureReader {
    inner: Box<dyn Read + Send>,
    capture: error_capture::ErrorCapture,
}

impl Read for ProxyErrorCaptureReader {
    fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
        if target.is_empty() {
            return Ok(0);
        }
        // Observe only bytes already pulled by the client; logging must never read ahead or retry a stream.
        let count = match self.inner.read(target) {
            Ok(count) => count,
            Err(error) => {
                record_captured_proxy_errors(self.capture.finish_with_error(&error));
                return Err(error);
            }
        };
        let errors = if count == 0 {
            self.capture.finish()
        } else {
            self.capture.observe(&target[..count])
        };
        record_captured_proxy_errors(errors);
        Ok(count)
    }
}
