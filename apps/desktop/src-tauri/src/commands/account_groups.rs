const MAX_ACCOUNT_GROUP_LENGTH: usize = 80;
const MAX_ACCOUNT_GROUP_COUNT: usize = 100;

fn normalize_account_group(value: &str) -> Result<String, String> {
    let group = value.trim();
    if group.chars().count() > MAX_ACCOUNT_GROUP_LENGTH {
        return Err("Account group must be 80 characters or fewer".to_string());
    }
    if group.chars().any(char::is_control) {
        return Err("Account group contains unsupported characters".to_string());
    }
    Ok(group.to_string())
}

fn normalize_account_groups(groups: Vec<String>) -> Result<Vec<String>, String> {
    if groups.len() > MAX_ACCOUNT_GROUP_COUNT {
        return Err(format!(
            "No more than {MAX_ACCOUNT_GROUP_COUNT} account groups are allowed"
        ));
    }
    let mut normalized = Vec::new();
    for group in groups {
        let group = normalize_account_group(&group)?;
        if group.is_empty() {
            return Err("Account group name is required".to_string());
        }
        if !normalized.contains(&group) {
            normalized.push(group);
        }
    }
    Ok(normalized)
}

fn clear_empty_concurrent_account_group(paths: &Paths) -> Result<bool, String> {
    let mut state = try_read_state(paths)?;
    let Some(selected_group) = state.concurrent_account_group.as_deref() else {
        return Ok(false);
    };
    let has_enabled_member = fs::read_dir(&paths.accounts)
        .map_err(|error| format!("Failed to read account directory: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .any(|id| {
            !state.disabled_account_ids.contains(&id)
                && managed_auth_path(paths, &id).is_file()
                && load_account_group(&account_group_path(paths, &id)) == selected_group
        });
    if has_enabled_member {
        return Ok(false);
    }
    state.concurrent_account_group = None;
    let enabled = state.concurrent_account_routing_enabled;
    change_concurrent_account_routing(&mut state, enabled, "empty account group fallback");
    write_state(paths, &state)?;
    Ok(true)
}

fn ensure_account_group_change_allowed(paths: &Paths, id: &str, group: &str) -> Result<(), String> {
    let current = load_account_group(&account_group_path(paths, id));
    let state = try_read_state(paths)?;
    if current != group && state.active_provider_group.as_deref()
        .is_some_and(|active| active == current || active == group)
    {
        return Err("Stop the active Provider group before changing it".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_account_group<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
    group: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        if !managed_auth_path(&paths, &id).exists() && !crate::claude_accounts::exists(&paths, &id) {
            return Err("Account does not exist".to_string());
        }
        let group = normalize_account_group(&group)?;
        ensure_account_group_change_allowed(&paths, &id, &group)?;
        save_account_group(&account_group_path(&paths, &id), &group)?;
        if !group.is_empty() {
            let mut settings = read_app_settings(&app)?;
            if !settings.account_groups.contains(&group) {
                settings.account_groups.push(group.clone());
                settings.provider_groups.clone_from(&settings.account_groups);
                write_app_settings(&app, &settings)?;
            }
        }
        let cleared_concurrent_group = clear_empty_concurrent_account_group(&paths)?;
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        if cleared_concurrent_group {
            app.emit("providers-changed", ())
                .map_err(|error| error.to_string())?;
        }
        Ok(group)
    })
    .await
    .map_err(|error| format!("Account group update task failed: {error}"))?
}

#[cfg(test)]
mod account_group_tests {
    use super::*;

    #[test]
    fn account_group_catalog_trims_and_deduplicates_names() {
        assert_eq!(
            normalize_account_groups(vec![" Work ".into(), "Work".into(), "Home".into()])
                .unwrap(),
            vec!["Work", "Home"]
        );
    }

    #[test]
    fn account_group_rejects_control_characters_and_long_names() {
        assert!(normalize_account_group("bad\nname").is_err());
        assert!(normalize_account_group(&"x".repeat(MAX_ACCOUNT_GROUP_LENGTH + 1)).is_err());
    }
}

#[tauri::command]
pub(crate) async fn set_account_groups<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    groups: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let groups = normalize_account_groups(groups)?;
        let mut settings = read_app_settings(&app)?;
        settings.account_groups.clone_from(&groups);
        settings.provider_groups.clone_from(&groups);
        write_app_settings(&app, &settings)?;
        Ok(groups)
    })
    .await
    .map_err(|error| format!("Account group catalog update task failed: {error}"))?
}
