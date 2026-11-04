pub(crate) fn set_appearance(app: &AppHandle, appearance: &str) -> Result<(), String> {
    if !matches!(appearance, "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let active_root = active_theme_root()?;
    let mut document = load_theme(&active_root)?.document;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "Theme metadata root must be an object.".to_string())?;
    object.remove("artMetadata");
    object.insert(
        "appearance".to_string(),
        Value::String(appearance.to_string()),
    );
    write_json(&active_root.join("theme.json"), &document)?;
    ensure_monitor(paths);
    wake_monitor();
    Ok(())
}

pub(crate) fn set_overlay_opacity(app: &AppHandle, opacity: f64) -> Result<(), String> {
    if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
        return Err("Theme overlay opacity must be between 0 and 1.".to_string());
    }
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let active_root = active_theme_root()?;
    let mut document = load_theme(&active_root)?.document;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "Theme metadata root must be an object.".to_string())?;
    object.remove("artMetadata");
    let art = object
        .get_mut("art")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Theme art settings must be an object.".to_string())?;
    art.insert("overlayOpacity".to_string(), json!(opacity));
    write_json(&active_root.join("theme.json"), &document)?;
    ensure_monitor(paths);
    wake_monitor();
    Ok(())
}

pub(crate) fn set_paused(app: &AppHandle, paused: bool) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    if paused {
        fs::write(pause_path()?, b"paused\n")
            .map_err(|error| format!("Failed to pause Dream Skin: {error}"))?;
        let state = read_session();
        if let Some(port) = state.port {
            if let Ok(targets) = list_targets(port) {
                for target in targets {
                    let _ = remove_target(&target, port, None);
                }
            }
        }
        let mut state = state;
        state.session = NativeRuntimeStatus::Paused;
        write_session(&state)?;
        wake_monitor();
        Ok(())
    } else {
        let _ = fs::remove_file(pause_path()?);
        restart_managed_runtime(&paths, SkinVerificationMode::Required)
    }
}

pub(crate) fn reapply(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    let paths = ensure_installed(app)?;
    let _ = fs::remove_file(pause_path()?);
    restart_managed_runtime(&paths, SkinVerificationMode::Required)
}

pub(crate) fn verify(app: &AppHandle) -> Result<String, String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    ensure_installed(app)?;
    let state = read_session();
    let port = state.port.ok_or_else(|| {
        "Dream Skin is installed but Codex has not been launched with it.".to_string()
    })?;
    let targets = wait_for_verified(port, Duration::from_secs(10))?;
    serde_json::to_string_pretty(&json!({
        "pass": true,
        "runtime": "rust-native",
        "runtimeVersion": NATIVE_RUNTIME_VERSION,
        "skinVersion": SKIN_VERSION,
        "port": port,
        "targets": targets
    }))
    .map_err(|error| format!("Failed to serialize verification result: {error}"))
}

pub(crate) fn restore(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Dream Skin operation lock is unavailable.".to_string())?;
    if !marker_path()?.is_file() {
        return Err("Dream Skin is not installed.".to_string());
    }
    let state = read_session();
    if let Some(port) = state.port {
        if let Ok(targets) = list_targets(port) {
            for target in targets {
                let _ = remove_target(&target, port, None);
            }
        }
    }
    for path in [marker_path()?, pause_path()?] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Failed to remove {}: {error}", path.display())),
        }
    }
    wake_monitor();
    restart_managed_runtime(&runtime_paths_for_app(app)?, SkinVerificationMode::Required)
}

fn list_saved_themes() -> Vec<DreamSkinThemeSummary> {
    let Ok(root) = themes_root() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut themes = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Ok(theme) = load_theme(&entry.path()) else {
            continue;
        };
        let Some(id) = theme
            .document
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_theme_id(id))
        else {
            continue;
        };
        if RETIRED_THEME_IDS.contains(&id) {
            continue;
        }
        let name = theme
            .document
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(id);
        themes.push(DreamSkinThemeSummary {
            id: id.to_string(),
            name: name.to_string(),
        });
    }
    themes.sort_by_key(|theme| theme.name.to_lowercase());
    themes
}

pub(crate) fn status(platform: &str) -> DreamSkinStatus {
    let installed = marker_path().is_ok_and(|path| path.is_file());
    let available = runtime_enhancements_enabled();
    let paused = !available || pause_path().is_ok_and(|path| path.is_file());
    let session_state = read_session();
    let active = active_theme_root()
        .ok()
        .and_then(|path| load_theme(&path).ok());
    let session = if !installed {
        "notInstalled"
    } else if paused || session_state.session == NativeRuntimeStatus::Paused {
        "paused"
    } else if session_state.port.is_some() && session_state.session == NativeRuntimeStatus::Active {
        "active"
    } else {
        "ready"
    };
    DreamSkinStatus {
        supported: true,
        available,
        restart_required: session_state.port.is_none(),
        platform: platform.to_string(),
        installed,
        runtime_installed: installed,
        session: session.to_string(),
        active_theme_id: active
            .as_ref()
            .and_then(|theme| theme.document.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        active_theme_name: active
            .as_ref()
            .and_then(|theme| theme.document.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        active_theme_appearance: active
            .as_ref()
            .and_then(|theme| theme.document.get("appearance"))
            .and_then(Value::as_str)
            .map(str::to_string),
        active_theme_overlay_opacity: active.as_ref().map(|theme| {
            theme
                .document
                .get("art")
                .and_then(|art| art.get("overlayOpacity"))
                .and_then(Value::as_f64)
                .unwrap_or(0.8)
        }),
        engine_path: marker_path().ok().map(|path| path.display().to_string()),
        saved_themes: list_saved_themes(),
    }
}

pub(crate) fn theme_preview(theme_id: &str, thumbnail: bool) -> Result<Option<String>, String> {
    let theme = preview_theme(theme_id)?;
    if thumbnail {
        return thumbnail::encode(&theme.image_bytes)
            .map(Some)
            .map_err(|error| error.to_string());
    }
    Ok(Some(format!(
        "data:{};base64,{}",
        theme.mime,
        BASE64.encode(theme.image_bytes)
    )))
}

fn preview_theme(theme_id: &str) -> Result<LoadedTheme, String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    // Imported images may only exist in the active theme until the user saves them.
    if let Ok(root) = active_theme_root() {
        if let Ok(theme) = load_theme(&root) {
            if theme.document.get("id").and_then(Value::as_str) == Some(theme_id) {
                return Ok(theme);
            }
        }
    }
    if BUILT_IN_THEME_IDS.contains(&theme_id) {
        let root = crate::dream_skin_resources::installed_pack_root()?;
        return load_theme(&built_in_theme_directory(&root, theme_id)?);
    }
    load_theme(&saved_theme_directory(theme_id)?)
}
