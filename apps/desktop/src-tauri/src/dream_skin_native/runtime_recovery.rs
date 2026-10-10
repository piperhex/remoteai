fn renderer_recovery_required(skin_active: bool, proxy_running: bool) -> bool {
    skin_active || proxy_running
}

fn recovery_is_enabled() -> Result<bool, String> {
    if !runtime_enhancements_enabled() {
        return Ok(false);
    }
    let skin_active = marker_path()?.is_file() && !pause_path()?.is_file();
    Ok(renderer_recovery_required(
        skin_active,
        runtime_proxy_running(),
    ))
}

#[cfg(target_os = "windows")]
fn running_recovery_install() -> Option<CodexInstall> {
    find_running_codex_install()
}

#[cfg(not(target_os = "windows"))]
fn running_recovery_install() -> Option<CodexInstall> {
    None
}

fn recover_after_outage(
    paths: &RuntimePaths,
    observed: &NativeSessionState,
    recovery: &mut RendererRecovery,
) -> Result<(), String> {
    if RUNTIME_LAUNCHING.load(Ordering::Acquire)
        || !observed.allows_recovery()
        || !recovery_is_enabled()?
    {
        recovery.reset();
        return Ok(());
    }
    let Some(install) = running_recovery_install() else {
        recovery.reset();
        return Ok(());
    };
    if !recovery.outage_ready(observed, &install.executable, Instant::now()) {
        return Ok(());
    }
    recovery.reset();
    recover_running_codex(paths, observed, &install)
}

fn recover_running_codex(
    paths: &RuntimePaths,
    observed: &NativeSessionState,
    expected_install: &CodexInstall,
) -> Result<(), String> {
    // Never queue a destructive operation behind a manual restart or theme change.
    let _operation = match OPERATION_LOCK.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Codex runtime operation lock is unavailable: {error}"
            ))
        }
    };
    let mut state = read_session();
    if !state.same_launch(observed)
        || !state.allows_recovery_for(&expected_install.executable)
        || !recovery_is_enabled()?
    {
        return Ok(());
    }
    let Some(port) = state.port else {
        return Ok(());
    };
    if !matches!(list_targets(port), Err(error) if error.contains("CDP is unavailable")) {
        return Ok(());
    }
    let Some(install) =
        running_recovery_install().filter(|current| same_install(current, expected_install))
    else {
        return Ok(());
    };
    // Persist before stopping anything. A crash, failed launch, port change or csw
    // restart cannot grant another automatic attempt; only an explicit launch can.
    state.recovery_attempted = true;
    write_session(&state)?;
    start_managed_runtime(
        paths,
        &install,
        SkinVerificationMode::Background,
        RuntimeLaunchReason::Recovery,
    )
}
