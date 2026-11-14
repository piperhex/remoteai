fn handle_request(app: AppHandle, request: Request, security: WebRequestSecurity) {
    if request.url().starts_with("/browser-home/site/") {
        crate::browser_home::respond_hosted(&app, request);
        return;
    }
    if request.url().starts_with(crate::codex_gui::file_preview::hosted::PATH_PREFIX) {
        crate::codex_gui::file_preview::hosted::respond(&app, request);
        return;
    }
    if request.url().split('?').next() == Some(WEB_INVOKE_PATH) {
        handle_invoke_request(app, request, &security);
        return;
    }

    if !matches!(request.method(), Method::Get | Method::Head) {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }

    let Some(path) = asset_path(request.url()) else {
        respond_text(request, StatusCode(400), "Invalid asset path");
        return;
    };
    let is_index = path == "index.html" || !path.contains('.');
    let asset = app.asset_resolver().get(path.clone()).or_else(|| {
        (!path.contains('.'))
            .then(|| app.asset_resolver().get("index.html".into()))
            .flatten()
    });
    let Some(asset) = asset else {
        respond_text(request, StatusCode(404), "Not found");
        return;
    };

    let bytes = if is_index {
        inject_hosted_runtime_marker(asset.bytes.as_ref())
    } else {
        asset.bytes
    };
    let mut response = Response::from_data(bytes).with_status_code(StatusCode(200));
    response.add_header(header("Content-Type", &asset.mime_type));
    response.add_header(header(
        "Content-Security-Policy",
        WEB_CONTENT_SECURITY_POLICY,
    ));
    response.add_header(header("X-Content-Type-Options", "nosniff"));
    response.add_header(header("X-Frame-Options", "DENY"));
    response.add_header(header("Referrer-Policy", "no-referrer"));
    response.add_header(header(
        "Cache-Control",
        if is_index {
            "no-cache"
        } else {
            "public, max-age=31536000, immutable"
        },
    ));
    let _ = request.respond(response);
}

fn handle_invoke_request(app: AppHandle, mut request: Request, security: &WebRequestSecurity) {
    if request.method() != &Method::Post {
        respond_text(request, StatusCode(405), "Method not allowed");
        return;
    }
    if let Err(status) = security.authorize(&request) {
        let message = if status == StatusCode(403) {
            "Request origin is not allowed"
        } else {
            "A valid LAN access key is required"
        };
        respond_text(request, status, message);
        return;
    }
    if !request.headers().iter().any(|header| {
        header.field.equiv("Content-Type") && header.value.as_str().starts_with("application/json")
    }) {
        respond_text(
            request,
            StatusCode(415),
            "Expected an application/json request",
        );
        return;
    }
    use tauri::Manager;
    // Authentication above grants access to the desktop host. P2P uploads must also fit through
    // its hosted HTTP adapter; the GUI worker still validates each message's upload provenance.
    let direct_upload = request.headers().iter().any(|header| {
        header.field.equiv("X-Codex-Chat-Transfer") && header.value.as_str() == "direct"
    });
    let max_body_bytes = if direct_upload {
        usize::MAX
    } else {
        match app.state::<crate::codex_gui::GuiState>().upload_policy.snapshot() {
            Ok(limits) => limits.message_bytes(),
            Err(_) => {
                respond_text(request, StatusCode(503), "Please try again later");
                return;
            }
        }
    };
    if request
        .body_length()
        .is_some_and(|length| length > max_body_bytes)
    {
        respond_text(request, StatusCode(413), "Request body is too large");
        return;
    }

    let mut body = String::new();
    let read_result = request
        .as_reader()
        .take(max_body_bytes.saturating_add(1) as u64)
        .read_to_string(&mut body);
    if read_result.is_err() || body.len() > max_body_bytes {
        respond_text(request, StatusCode(400), "Could not read the request body");
        return;
    }
    let invocation = match serde_json::from_str::<WebInvokeRequest>(&body) {
        Ok(invocation) => invocation,
        Err(error) => {
            respond_text(
                request,
                StatusCode(400),
                &format!("Invalid invoke request: {error}"),
            );
            return;
        }
    };
    let response = match dispatch_command(app, &invocation.command, invocation.args) {
        Ok(result) => WebInvokeResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => WebInvokeResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    respond_json(request, StatusCode(200), &response);
}
