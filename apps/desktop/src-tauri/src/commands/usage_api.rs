fn api_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建网络客户端失败：{error}"))
}

struct RequestAuth {
    value: Value,
    persisted: Value,
}

impl RequestAuth {
    fn new(value: Value) -> Self {
        Self {
            persisted: value.clone(),
            value,
        }
    }

    fn persist(&mut self, paths: &Paths, id: &str) -> Result<bool, String> {
        if write_managed_auth_if_unchanged(paths, id, &self.persisted, &self.value)? {
            self.persisted = self.value.clone();
            sync_active_auth(paths, id, &self.value)?;
            return Ok(true);
        }
        self.value = load_managed_auth_value(paths, id)?;
        self.persisted = self.value.clone();
        Ok(false)
    }

    fn reload_if_changed(&mut self, paths: &Paths, id: &str) -> Result<bool, String> {
        let current = load_managed_auth_value(paths, id)?;
        if current == self.persisted {
            return Ok(false);
        }
        self.value = current.clone();
        self.persisted = current;
        Ok(true)
    }

    fn refresh(&mut self, client: &Client, paths: &Paths, id: &str) -> Result<(), String> {
        if self.reload_if_changed(paths, id)? {
            return Ok(());
        }
        if let Err(error) = refresh_tokens(client, &mut self.value) {
            return if self.reload_if_changed(paths, id)? {
                Ok(())
            } else {
                Err(error)
            };
        }
        self.persist(paths, id)?;
        Ok(())
    }
}

fn refresh_auth_if_needed(
    client: &Client,
    auth: &mut RequestAuth,
    paths: &Paths,
    id: &str,
) -> Result<(), String> {
    if is_agent_identity_auth(&auth.value) {
        return Ok(());
    }
    if token_expiring(&auth.value) {
        auth.refresh(client, paths, id)?;
    }
    Ok(())
}

fn is_active_account(paths: &Paths, id: &str) -> bool {
    read_state(paths).active_account_id.as_deref() == Some(id)
}

fn load_managed_auth_value(paths: &Paths, id: &str) -> Result<Value, String> {
    let managed_path = managed_auth_path(paths, id);
    // The current .codex/auth.json is a startup-only import source. Subsequent
    // account operations use the managed copy so external file changes cannot
    // silently alter the active account.
    let original = read_json(&managed_path)?;
    let mut auth = original.clone();
    if canonicalize_chatgpt_auth(&mut auth)?
        && !write_managed_auth_if_unchanged(paths, id, &original, &auth)?
    {
        return load_managed_auth_value(paths, id);
    }
    validate_auth(&auth)?;
    Ok(auth)
}

fn load_auth_for_request<R: Runtime>(
    _app: &tauri::AppHandle<R>,
    paths: &Paths,
    id: &str,
) -> Result<RequestAuth, String> {
    load_managed_auth_value(paths, id).map(RequestAuth::new)
}

#[tauri::command]
pub(crate) async fn refresh_usage<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_usage_blocking(app, id))
        .await
        .map_err(|error| format!("刷新用量任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn consume_account_quota<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || consume_account_quota_blocking(app, id))
        .await
        .map_err(|error| format!("消耗额度任务失败：{error}"))?
}

pub(crate) fn consume_account_quota_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if read_state(&paths)
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == &id)
    {
        return Err("Account is disabled; quota consumption was skipped".to_string());
    }
    let mut auth = load_auth_for_request(&app, &paths, &id)?;
    let client = quota_consumption_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, &id)?;

    let response = if is_agent_identity_auth(&auth.value) {
        if agent_identity::ensure_task(&client, &mut auth.value)? {
            auth.persist(&paths, &id)?;
        }
        let response = send_quota_consumption_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("读取 Agent Identity 鉴权失败响应失败：{error}"))?;
            if !agent_identity::is_invalid_task_response(status, &body) {
                return Err(format!("Codex 对话接口返回 HTTP {status}"));
            }
            agent_identity::register_task(&client, &mut auth.value)?;
            auth.persist(&paths, &id)?;
            send_quota_consumption_request(&client, &auth.value)?
        } else {
            response
        }
    } else {
        let mut response = send_quota_consumption_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            auth.refresh(&client, &paths, &id)?;
            response = send_quota_consumption_request(&client, &auth.value)?;
        }
        response
    };

    ensure_quota_consumption_completed(response)?;
    auth.persist(&paths, &id).map(|_| ())
}

fn quota_consumption_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("创建额度消耗网络客户端失败：{error}"))
}

fn send_quota_consumption_request(client: &Client, auth: &Value) -> Result<Response, String> {
    if is_agent_identity_auth(auth) {
        let authentication = agent_identity::request_authentication(auth)?;
        return quota_consumption_request(
            client,
            &authentication.authorization,
            Some(&authentication.account_id),
            authentication.is_fedramp,
        );
    }

    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    quota_consumption_request(
        client,
        &format!("Bearer {access_token}"),
        account_id.as_deref(),
        false,
    )
}

fn ensure_quota_consumption_completed(response: Response) -> Result<(), String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("读取 Codex 对话响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("Codex 对话接口返回 HTTP {status}"));
    }
    if !quota_consumption_response_completed(&body) {
        return Err("Codex 对话流未正常完成".to_string());
    }
    Ok(())
}

fn update_account_details_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    input: UpdateAccountDetailsInput,
) -> Result<(), String> {
    let UpdateAccountDetailsInput {
        id,
        note,
        expires_at,
        private_details,
    } = input;
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    let (official, metadata_editable) = load_official_account_access(&paths, &id);
    if official && !metadata_editable {
        return Err(
            "You do not have permission to edit this official account's note or expiration date"
                .to_string(),
        );
    }
    if !expires_at.is_empty() {
        NaiveDate::parse_from_str(&expires_at, "%Y-%m-%d")
            .map_err(|_| "Expiration date must use YYYY-MM-DD format".to_string())?;
    }
    let private_details = private_details.normalized()?;
    save_note(&note_path(&paths, &id), &note)?;
    save_expiration(&expiration_path(&paths, &id), &expires_at)?;
    save_account_private_details(&account_private_details_path(&paths, &id), &private_details)?;
    touch_account_field(&paths, &id, AccountSyncField::Note)?;
    touch_account_field(&paths, &id, AccountSyncField::ExpiresAt)?;
    touch_account_field(&paths, &id, AccountSyncField::PrivateDetails)?;
    crate::providers::refresh_group_account_labels(&app, &id)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn update_account_note<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    input: UpdateAccountDetailsInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || update_account_details_blocking(app, input))
        .await
        .map_err(|error| format!("Account details task failed: {error}"))?
}

pub(crate) fn refresh_usage_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<UsageSummary, String> {
    match try_refresh_usage_blocking(&app, &id) {
        Ok(usage) => Ok(usage),
        Err(error) => {
            if let Ok(paths) = resolve_paths(&app) {
                let settings = read_app_settings(&app).unwrap_or_default();
                let should_report_error =
                    settings.show_usage_network_errors || !is_usage_network_error(&error);
                let cached = UsageSummary {
                    error: should_report_error.then(|| error.clone()),
                    fetched_at: Some(Utc::now().to_rfc3339()),
                    ..load_usage(&usage_path(&paths, &id))
                };
                if save_usage(&usage_path(&paths, &id), &cached).is_ok() {
                    let _ = touch_account_field(&paths, &id, AccountSyncField::Usage);
                }
                // A usage refresh can fail for temporary reasons (for example, a network
                // disconnect or timeout). Only an explicitly configured upstream HTTP status
                // can turn a failure into a persisted account exclusion.
                let state = read_state(&paths);
                let disable_error = if should_disable_account_auto_switch(
                    &error,
                    state.auto_switch_on_quota_exhaustion
                        && state.auto_disable_unreachable_accounts,
                    &settings.auto_disable_status_codes,
                ) {
                    set_account_auto_switch_enabled_for_paths(&paths, &id, false).err()
                } else {
                    None
                };
                let _ = app.emit("accounts-changed", ());
                crate::system_tray::refresh_menu(&app);
                if let Some(disable_error) = disable_error {
                    return Err(format!("{error}；自动禁用账号失败：{disable_error}"));
                }
                if !should_report_error {
                    return Ok(cached);
                }
            }
            Err(error)
        }
    }
}
