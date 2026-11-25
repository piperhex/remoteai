//! Exercise the actual launch flow without stopping or starting desktop applications.
use super::{
    managed_runtime_arguments, CodexInstall, NativeRuntimeStatus, NativeSessionState,
    RuntimeLaunchReason, RuntimePaths, SkinVerificationMode, CODEX_RENDERER_START_TIMEOUT,
};
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Default)]
struct Simulation {
    session: NativeSessionState,
    enhancements: bool,
    launch_fails: bool,
    write_fails: bool,
    arguments: Vec<Vec<String>>,
    debug_operations: usize,
    stops: usize,
    refreshes: usize,
}

thread_local! {
    static SIMULATION: RefCell<Simulation> = RefCell::new(Simulation::default());
}

fn with_simulation<T>(operation: impl FnOnce(&mut Simulation) -> T) -> T {
    SIMULATION.with(|state| operation(&mut state.borrow_mut()))
}

struct RuntimeLaunchGuard;

impl RuntimeLaunchGuard {
    fn acquire() -> Self {
        Self
    }
}

fn read_session() -> NativeSessionState {
    with_simulation(|state| state.session.clone())
}

fn write_session(session: &NativeSessionState) -> Result<(), String> {
    with_simulation(|state| {
        if state.write_fails {
            return Err("write failed".into());
        }
        state.session = session.clone();
        Ok(())
    })
}

fn runtime_enhancements_enabled() -> bool {
    with_simulation(|state| state.enhancements)
}

fn stop_codex(_: &CodexInstall) -> Result<(), String> {
    with_simulation(|state| state.stops += 1);
    Ok(())
}

fn launch_codex(_: &CodexInstall, arguments: &[String]) -> Result<u32, String> {
    with_simulation(|state| {
        state.arguments.push(arguments.to_vec());
        if state.launch_fails {
            return Err("launch failed".into());
        }
        Ok(1)
    })
}

fn record_debug_operation() {
    with_simulation(|state| {
        assert!(
            state.enhancements,
            "ordinary launches must not access CDP or its profile"
        );
        state.debug_operations += 1;
    });
}

fn select_port() -> Result<u16, String> {
    record_debug_operation();
    Ok(9335)
}

fn cdp_profile_path() -> Result<PathBuf, String> {
    record_debug_operation();
    Ok(PathBuf::from("simulated/cdp-profile"))
}

fn ensure_directory(_: &Path) -> Result<(), String> {
    record_debug_operation();
    Ok(())
}

fn ensure_monitor(_: RuntimePaths) {
    record_debug_operation();
}
fn wake_monitor() {
    record_debug_operation();
}

fn wait_for_startup_window(
    _: u16,
    _: Duration,
    _: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    record_debug_operation();
    Ok(())
}

fn verify_runtime_skin(
    _: &RuntimePaths,
    _: SkinVerificationMode,
    _: Option<u16>,
) -> Result<(), String> {
    Ok(())
}

fn refresh_after_launch() {
    with_simulation(|state| {
        assert_eq!(state.session.session, NativeRuntimeStatus::Active);
        state.refreshes += 1;
    });
}

include!("runtime_launch.rs");

fn launch() -> Result<(), String> {
    start_managed_runtime(
        &RuntimePaths {
            bundled_root: PathBuf::new(),
        },
        &CodexInstall {
            executable: PathBuf::from("simulated/ChatGPT.exe"),
            #[cfg(target_os = "windows")]
            app_user_model_id: None,
        },
        SkinVerificationMode::Background,
        RuntimeLaunchReason::Explicit,
    )
}

#[test]
fn ordinary_launch_uses_no_arguments_and_clears_previous_debug_session() {
    with_simulation(|state| {
        state.session.session = NativeRuntimeStatus::Active;
        state.session.port = Some(9445);
        state.session.launch_id = "previous-launch".into();
    });
    launch().unwrap();
    with_simulation(|state| {
        assert_eq!(state.arguments, vec![Vec::<String>::new()]);
        assert_eq!(state.stops, 1);
        assert_eq!(state.debug_operations, 0);
        assert_eq!(state.session.port, None);
        assert_eq!(state.session.session, NativeRuntimeStatus::Ready);
        assert_ne!(state.session.launch_id, "previous-launch");
        assert!(!state.session.allows_recovery());
        assert_eq!(state.refreshes, 0);
    });
}

#[test]
fn enabled_enhancements_keep_the_existing_debug_launch() {
    with_simulation(|state| state.enhancements = true);
    launch().unwrap();
    with_simulation(|state| {
        assert_eq!(
            state.arguments,
            vec![managed_runtime_arguments(
                9335,
                Path::new("simulated/cdp-profile")
            )]
        );
        assert_eq!(state.session.port, Some(9335));
        assert_eq!(state.session.session, NativeRuntimeStatus::Active);
        assert!(state.debug_operations > 0);
        assert_eq!(state.refreshes, 1);
    });
}

#[test]
fn ordinary_launch_failure_never_falls_back_to_debug_mode() {
    with_simulation(|state| state.launch_fails = true);
    assert!(launch().is_err());
    with_simulation(|state| {
        assert_eq!(state.arguments, vec![Vec::<String>::new()]);
        assert_eq!(state.session.session, NativeRuntimeStatus::Failed);
        assert!(!state.session.allows_recovery());
        assert_eq!(state.refreshes, 0);
    });
}

#[test]
fn failed_session_write_prevents_stopping_or_launching_a_client() {
    with_simulation(|state| state.write_fails = true);
    assert!(launch().is_err());
    with_simulation(|state| {
        assert_eq!(state.stops, 0);
        assert!(state.arguments.is_empty());
        assert_eq!(state.refreshes, 0);
    });
}

#[test]
fn every_managed_restart_refreshes_models_and_composer_controls() {
    with_simulation(|state| state.enhancements = true);
    launch().unwrap();
    launch().unwrap();
    with_simulation(|state| assert_eq!(state.refreshes, 2));
}

#[test]
fn failed_managed_launch_does_not_schedule_a_refresh() {
    with_simulation(|state| {
        state.enhancements = true;
        state.launch_fails = true;
    });
    assert!(launch().is_err());
    with_simulation(|state| assert_eq!(state.refreshes, 0));
}
