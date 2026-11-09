use super::*;

pub(super) fn collect_local_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<CloudAccountPayload>, String> {
    let paths = resolve_paths(app)?;
    fs::create_dir_all(&paths.accounts)
        .map_err(|error| format!("Failed to create account store: {error}"))?;
    let active_id = read_state(&paths).active_account_id;
    let mut accounts = Vec::new();
    for entry in fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read account store: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let auth_path = entry.path().join("auth.json");
        if !auth_path.exists() {
            continue;
        }
        let mut auth = read_json(&auth_path)?;
        let repaired = canonicalize_chatgpt_auth(&mut auth)?;
        validate_auth(&auth)?;
        let (email, auth_plan, account_id, id) = account_fields(&auth)?;
        if repaired {
            write_managed_auth_if_changed(&paths, &id, &auth)?;
        }
        let field_modified_at = load_or_init_account_field_modified_at(&paths, &id)?;
        let last_modified_at = load_or_init_last_modified(&paths, &id)?.to_rfc3339();
        let mut usage = load_usage(&usage_path(&paths, &id));
        usage.api_expires_at = subscription_active_until(&auth);
        let plan = usage
            .plan
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(auth_plan);
        let (official, metadata_editable) = load_official_account_access(&paths, &id);
        let private_details_path = account_private_details_path(&paths, &id);
        accounts.push(CloudAccountPayload {
            active: active_id.as_deref() == Some(&id),
            auto_switch_priority: load_auto_switch_priority(&auto_switch_priority_path(
                &paths, &id,
            )),
            auto_switch_threshold: load_auto_switch_threshold(&auto_switch_threshold_path(
                &paths, &id,
            )),
            usage,
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            private_details: private_details_path
                .exists()
                .then(|| load_account_private_details(&private_details_path)),
            last_modified_at,
            field_modified_at,
            id,
            email,
            plan,
            account_id,
            auth,
            official,
            metadata_editable,
        });
    }
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
}

pub(super) fn collect_local_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<CloudAccountPayload, String> {
    collect_local_accounts(app)?
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| format!("Local account {id} does not exist"))
}

pub(super) fn normalize_account_field_modified_at(
    mut values: AccountFieldModifiedAt,
    fallback: &str,
) -> AccountFieldModifiedAt {
    for value in [
        &mut values.auth,
        &mut values.note,
        &mut values.expires_at,
        &mut values.private_details,
        &mut values.usage,
        &mut values.active,
        &mut values.auto_switch_priority,
        &mut values.auto_switch_threshold,
    ] {
        if value.trim().is_empty() {
            *value = fallback.to_string();
        }
    }
    values
}

pub(super) fn remote_field_is_newer(local: &str, remote: &str) -> bool {
    match (parse_last_modified(local), parse_last_modified(remote)) {
        (Some(local), Some(remote)) => remote > local,
        (None, Some(_)) => true,
        _ => false,
    }
}

pub(super) fn should_apply_remote_field(local_usable: bool, local: &str, remote: &str) -> bool {
    !local_usable || remote_field_is_newer(local, remote)
}

pub(super) fn apply_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &CloudAccountPayload,
) -> Result<bool, String> {
    apply_remote_account_with_activation(app, account, true)
}

pub(super) fn apply_remote_account_with_activation<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account: &CloudAccountPayload,
    allow_activation: bool,
) -> Result<bool, String> {
    let mut remote_auth = account.auth.clone();
    canonicalize_chatgpt_auth(&mut remote_auth)?;
    validate_auth(&remote_auth)?;
    let (_, _, _, computed_id) = account_fields(&remote_auth)?;
    if computed_id != account.id {
        return Err(format!(
            "Cloud account {} does not match its auth.json identity",
            account.email
        ));
    }
    let paths = resolve_paths(app)?;
    let access_changed = write_json_if_changed(
        &official_account_access_path(&paths, &account.id),
        &json!({
            "official": account.official,
            "metadataEditable": account.metadata_editable,
        }),
    )?;
    let auth_path = managed_auth_path(&paths, &account.id);
    let local_auth = read_json(&auth_path).ok();
    let local_usable = local_auth.as_ref().is_some_and(|auth| {
        validate_auth(auth).is_ok()
            && matches!(account_fields(auth), Ok((_, _, _, local_id)) if local_id == account.id)
    });
    let mut local_field_modified_at = load_or_init_account_field_modified_at(&paths, &account.id)?;
    let remote_field_modified_at = normalize_account_field_modified_at(
        account.field_modified_at.clone(),
        &account.last_modified_at,
    );
    let mut apply_auth = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.auth,
        &remote_field_modified_at.auth,
    );
    let apply_note = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.note,
        &remote_field_modified_at.note,
    );
    let apply_expires_at = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.expires_at,
        &remote_field_modified_at.expires_at,
    );
    let apply_private_details = account.private_details.is_some()
        && should_apply_remote_field(
            local_usable,
            &local_field_modified_at.private_details,
            &remote_field_modified_at.private_details,
        );
    let apply_usage = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.usage,
        &remote_field_modified_at.usage,
    );
    let apply_active = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.active,
        &remote_field_modified_at.active,
    );
    let apply_auto_switch_priority = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.auto_switch_priority,
        &remote_field_modified_at.auto_switch_priority,
    );
    let apply_auto_switch_threshold = should_apply_remote_field(
        local_usable,
        &local_field_modified_at.auto_switch_threshold,
        &remote_field_modified_at.auto_switch_threshold,
    );

    let account_auth = if apply_auth {
        let committed = match &local_auth {
            Some(expected) => {
                write_managed_auth_if_unchanged(&paths, &account.id, expected, &remote_auth)?
            }
            None => write_managed_auth_if_absent(&paths, &account.id, &remote_auth)?,
        };
        if committed {
            local_field_modified_at.auth = remote_field_modified_at.auth.clone();
            remote_auth.clone()
        } else {
            // A login or token refresh won the race while the cloud response was being applied.
            apply_auth = false;
            read_json(&auth_path)?
        }
    } else {
        local_auth.unwrap_or(remote_auth)
    };

    if apply_note {
        save_note(&note_path(&paths, &account.id), &account.note)?;
        local_field_modified_at.note = remote_field_modified_at.note.clone();
    }
    if apply_expires_at {
        save_expiration(&expiration_path(&paths, &account.id), &account.expires_at)?;
        local_field_modified_at.expires_at = remote_field_modified_at.expires_at.clone();
    }
    if apply_private_details {
        if let Some(details) = &account.private_details {
            let details = details.clone().normalized()?;
            save_account_private_details(
                &account_private_details_path(&paths, &account.id),
                &details,
            )?;
        }
        local_field_modified_at.private_details = remote_field_modified_at.private_details.clone();
        crate::providers::refresh_group_account_labels(app, &account.id)?;
    }
    if apply_usage {
        save_usage(&usage_path(&paths, &account.id), &account.usage)?;
        local_field_modified_at.usage = remote_field_modified_at.usage.clone();
    }
    if apply_active {
        local_field_modified_at.active = remote_field_modified_at.active.clone();
    }
    if apply_auto_switch_priority {
        save_auto_switch_priority(
            &auto_switch_priority_path(&paths, &account.id),
            account.auto_switch_priority,
        )?;
        local_field_modified_at.auto_switch_priority =
            remote_field_modified_at.auto_switch_priority.clone();
    }
    if apply_auto_switch_threshold {
        save_auto_switch_threshold(
            &auto_switch_threshold_path(&paths, &account.id),
            account.auto_switch_threshold,
        )?;
        local_field_modified_at.auto_switch_threshold =
            remote_field_modified_at.auto_switch_threshold.clone();
    }
    if apply_auth
        || apply_note
        || apply_expires_at
        || apply_private_details
        || apply_usage
        || apply_active
        || apply_auto_switch_priority
        || apply_auto_switch_threshold
    {
        save_account_field_modified_at(&paths, &account.id, &local_field_modified_at)?;
    }

    let active_account_id = read_state(&paths).active_account_id;
    if apply_auth && active_account_id.as_deref() == Some(&account.id) {
        crate::commands::sync_current_auth_if_client_stopped(&paths, &account_auth)?;
    } else if allow_activation && apply_active && account.active && active_account_id.is_none() {
        let proxy_running = crate::local_proxy::is_running();
        let can_activate = if proxy_running {
            !crate::auth::is_agent_identity_auth(&account_auth)
        } else {
            crate::commands::sync_current_auth_if_client_stopped(&paths, &account_auth)?
        };
        if can_activate {
            let mut state = read_state(&paths);
            state.active_account_id = Some(account.id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_state(app)?;
            }
        }
    }
    Ok(access_changed
        || apply_auth
        || apply_note
        || apply_expires_at
        || apply_private_details
        || apply_usage
        || apply_active
        || apply_auto_switch_priority
        || apply_auto_switch_threshold)
}

pub(super) fn get_remote_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<CloudAccountsResponse, String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::GET,
        "/sync/accounts",
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account download", response));
    }
    let payload: CloudAccountsResponse = response
        .json()
        .map_err(|error| format!("Cloud account download response is invalid: {error}"))?;
    Ok(payload)
}

pub(super) fn apply_remote_account_deletion<R: Runtime>(
    app: &tauri::AppHandle<R>,
    account_id: &str,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let target = crate::storage::account_dir(&paths, account_id);
    let existed = target.exists();
    if existed {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Failed to remove cloud-deleted account: {error}"))?;
    }
    let mut state = read_state(&paths);
    let was_active = state.active_account_id.as_deref() == Some(account_id);
    let disabled_count = state.disabled_account_ids.len();
    if was_active {
        state.active_account_id = None;
    }
    state.disabled_account_ids.retain(|id| id != account_id);
    let state_changed = was_active || state.disabled_account_ids.len() != disabled_count;
    if state_changed {
        write_state(&paths, &state)?;
    }
    Ok(existed || state_changed)
}
