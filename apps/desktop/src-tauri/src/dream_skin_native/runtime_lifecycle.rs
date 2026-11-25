fn verify_runtime_skin(paths: &RuntimePaths, mode: SkinVerificationMode, port: Option<u16>) -> Result<(), String> {
    if !runtime_enhancements_enabled() {
        return Ok(());
    }
    let skin_installed = marker_path()?.is_file();
    let skin_paused = pause_path()?.is_file();
    if skin_verification_required(skin_installed, skin_paused) {
        wake_monitor();
        if let Some(port) =
            port.filter(|_| wait_for_skin_verification(skin_installed, skin_paused, mode))
        {
            let revision = load_payload(paths)?.revision;
            wait_for_verified(port, DREAM_SKIN_START_VERIFICATION_TIMEOUT, Some(&revision))?;
        }
    }
    Ok(())
}

fn runtime_paths_for_app(app: &AppHandle) -> Result<RuntimePaths, String> {
    Ok(RuntimePaths {
        bundled_root: bundled_root(app)?,
    })
}

fn managed_runtime_arguments(port: u16, profile: &Path) -> Vec<String> {
    vec![
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", profile.display()),
    ]
}

fn skin_verification_required(skin_installed: bool, skin_paused: bool) -> bool {
    skin_installed && !skin_paused
}

fn wait_for_skin_verification(
    skin_installed: bool,
    skin_paused: bool,
    verification_mode: SkinVerificationMode,
) -> bool {
    skin_verification_required(skin_installed, skin_paused)
        && verification_mode == SkinVerificationMode::Required
}

fn restart_managed_runtime(
    paths: &RuntimePaths,
    verification_mode: SkinVerificationMode,
) -> Result<(), String> {
    let install = find_runtime_launch_install().inspect_err(|_| {
        let mut state = read_session();
        state.session = NativeRuntimeStatus::Failed;
        state.fail_launch();
        if let Err(error) = write_session(&state) {
            eprintln!("Could not save the failed Codex launch: {error}");
        }
    })?;
    // Select a valid installation before launching. A slow or failed renderer must
    // never cause another destructive restart into a different installation.
    start_managed_runtime(
        paths,
        &install,
        verification_mode,
        RuntimeLaunchReason::Explicit,
    )
}

pub(crate) fn setup_runtime(app: &AppHandle) -> Result<(), String> {
    let _operation = OPERATION_LOCK
        .lock()
        .map_err(|_| "Codex runtime operation lock is unavailable.".to_string())?;
    if marker_path()?.is_file() {
        initialize_store()?;
    }
    if !session_path()?.is_file() {
        write_session(&NativeSessionState::default())?;
    }
    let mut state = read_session();
    if state.session == NativeRuntimeStatus::Starting {
        state.fail_launch();
        write_session(&state)?;
    }
    ensure_monitor(runtime_paths_for_app(app)?);
    Ok(())
}

fn install_unlocked(app: &AppHandle, restart_chatgpt: bool) -> Result<(), String> {
    ensure_skin_allowed()?;
    initialize_store()?;
    if restart_chatgpt {
        load_theme(&active_theme_root()?).map_err(|_| {
            "Dream Skin preset resources are still downloading; choose a theme after they are ready."
                .to_string()
        })?;
    }
    write_json(
        &marker_path()?,
        &InstallationMarker {
            schema_version: 1,
            runtime: "rust-native".to_string(),
            version: NATIVE_RUNTIME_VERSION.to_string(),
        },
    )?;
    if !session_path()?.is_file() {
        write_session(&NativeSessionState::default())?;
    }
    let paths = runtime_paths_for_app(app)?;
    if restart_chatgpt {
        restart_managed_runtime(&paths, SkinVerificationMode::Required)
    } else {
        ensure_monitor(paths);
        Ok(())
    }
}

pub(crate) fn install(app: &AppHandle) -> Result<(), String> {
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    install_unlocked(app, true)
}

fn ensure_installed(app: &AppHandle) -> Result<RuntimePaths, String> {
    ensure_skin_allowed()?;
    if !marker_path()?.is_file() {
        install_unlocked(app, false)?;
    }
    let paths = runtime_paths_for_app(app)?;
    initialize_store()?;
    ensure_monitor(paths.clone());
    Ok(paths)
}

/// A saved port outlives ChatGPT when it exits or Windows replaces the package.
fn live_skin_port(state: &NativeSessionState) -> Option<u16> {
    if !matches!(state.session, NativeRuntimeStatus::Active | NativeRuntimeStatus::Paused) {
        return None;
    }
    state.port.filter(|port| list_targets(*port).is_ok_and(|targets| {
        targets.iter().any(|target| is_workspace_page(&target.url))
    }))
}

fn theme_change_port(restart_confirmed: Option<bool>) -> Result<Option<u16>, String> {
    let state = read_session();
    let installed = marker_path()?.is_file();
    let port = installed.then(|| live_skin_port(&state)).flatten();
    // Older clients only asked for confirmation on first install or when no port was saved.
    if port.is_none() && !restart_confirmed.unwrap_or(!installed || state.port.is_none()) {
        return Err("DREAM_SKIN_RESTART_REQUIRED".to_string());
    }
    Ok(port)
}

fn activate_selected_theme(paths: &RuntimePaths, port: Option<u16>) -> Result<(), String> {
    match fs::remove_file(pause_path()?) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    if let Some(port) = port {
        let revision = load_payload(paths)?.revision;
        wake_monitor();
        wait_for_verified(port, DREAM_SKIN_START_VERIFICATION_TIMEOUT, Some(&revision))?;
        let mut state = read_session();
        if state.port == Some(port) && state.session == NativeRuntimeStatus::Paused {
            state.session = NativeRuntimeStatus::Active;
            write_session(&state)?;
        }
        return Ok(());
    }
    restart_managed_runtime(paths, SkinVerificationMode::Required)
}

pub(crate) fn apply_theme(app: &AppHandle, theme_id: &str, restart_confirmed: Option<bool>) -> Result<(), String> {
    if !valid_theme_id(theme_id) {
        return Err("Theme id is invalid.".to_string());
    }
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    // A running Dream Skin session watches the active theme payload and
    // reinjects it when its revision changes. Initial installation and returning
    // from an ordinary launch both need a renderer channel before injection.
    let port = theme_change_port(restart_confirmed)?;
    let paths = ensure_installed(app)?;
    let directory = if BUILT_IN_THEME_IDS.contains(&theme_id) {
        let resource_root = crate::dream_skin_resources::installed_pack_root()?;
        built_in_theme_directory(&resource_root, theme_id)?
    } else {
        saved_theme_directory(theme_id)?
    };
    copy_theme_to_active(&directory)?;
    activate_selected_theme(&paths, port)
}

fn validate_import_options(options: &DreamSkinImportOptions) -> Result<(), String> {
    validate_name(&options.name)?;
    if !matches!(options.appearance.as_str(), "auto" | "light" | "dark") {
        return Err("Theme appearance is invalid.".to_string());
    }
    if !matches!(
        options.safe_area.as_str(),
        "auto" | "left" | "right" | "center" | "none"
    ) {
        return Err("Theme safe area is invalid.".to_string());
    }
    if !matches!(
        options.task_mode.as_str(),
        "auto" | "ambient" | "banner" | "off"
    ) {
        return Err("Theme task mode is invalid.".to_string());
    }
    for focus in [options.focus_x, options.focus_y].into_iter().flatten() {
        if !focus.is_finite() || !(0.0..=1.0).contains(&focus) {
            return Err("Theme focus coordinates must be between 0 and 1.".to_string());
        }
    }
    Ok(())
}

pub(crate) fn import_image(
    app: &AppHandle,
    path: &str,
    options: &DreamSkinImportOptions,
    restart_confirmed: Option<bool>,
) -> Result<(), String> {
    validate_import_options(options)?;
    let source = PathBuf::from(path);
    image_details(&source)?;
    ensure_no_reparse_points(&source)?;
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    let port = theme_change_port(restart_confirmed)?;
    let paths = ensure_installed(app)?;
    let staging = state_root()?.join("import-staging");
    ensure_directory(&staging)?;
    let (mime, _, _) = image_details(&source)?;
    let extension = match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    };
    let image_name = format!("art.{extension}");
    fs::copy(&source, staging.join(&image_name))
        .map_err(|error| format!("Failed to import theme image: {error}"))?;
    let document = json!({
        "schemaVersion": 1,
        "id": "custom",
        "name": options.name.trim(),
        "brandSubtitle": "CODEX DREAM SKIN",
        "tagline": "Make something wonderful.",
        "projectPrefix": "Select project - ",
        "projectLabel": "Select project",
        "statusText": "DREAM SKIN ONLINE",
        "quote": "MAKE SOMETHING WONDERFUL",
        "image": image_name,
        "appearance": options.appearance,
        "art": {
            "focusX": options.focus_x,
            "focusY": options.focus_y,
            "safeArea": options.safe_area,
            "taskMode": options.task_mode
        },
        "palette": {}
    });
    write_json(&staging.join("theme.json"), &document)?;
    copy_theme_to_active(&staging)?;
    save_current_theme(&options.name)?;
    activate_selected_theme(&paths, port)
}

pub(crate) fn save_theme(app: &AppHandle, name: &str) -> Result<(), String> {
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    ensure_installed(app)?;
    save_current_theme(name)?;
    Ok(())
}

fn validate_deletable_theme_id(theme_id: &str) -> Result<(), String> {
    if !valid_theme_id(theme_id) || BUILT_IN_THEME_IDS.contains(&theme_id) {
        return Err("Only saved community themes can be deleted.".to_string());
    }
    Ok(())
}

fn deletable_theme_directory(theme_id: &str) -> Result<PathBuf, String> {
    validate_deletable_theme_id(theme_id)?;
    let directory = themes_root()?.join(theme_id);
    let metadata = fs::symlink_metadata(&directory)
        .map_err(|_| format!("Saved theme does not exist: {theme_id}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "Saved theme is not a managed directory: {theme_id}"
        ));
    }
    ensure_no_reparse_points(&directory)?;
    saved_theme_directory(theme_id)
}

pub(crate) fn delete_themes(theme_ids: &[String]) -> Result<(), String> {
    if theme_ids.is_empty() {
        return Err("Select at least one saved theme to delete.".to_string());
    }
    let _operation = crate::client_lifecycle::try_lock(&OPERATION_LOCK)
        .map_err(|error| error.to_string())?;
    let unique_ids = theme_ids.iter().collect::<HashSet<_>>();
    let directories = unique_ids
        .into_iter()
        .map(|theme_id| deletable_theme_directory(theme_id).map(|path| (theme_id, path)))
        .collect::<Result<Vec<_>, _>>()?;
    for (theme_id, directory) in directories {
        fs::remove_dir_all(directory)
            .map_err(|_| format!("Failed to delete saved theme: {theme_id}"))?;
    }
    Ok(())
}
