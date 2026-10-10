//! Exercise the production recovery entry points with entirely in-memory dependencies.
//! The local names deliberately shadow production I/O and process operations.

use super::{
    CdpTarget, CodexInstall, NativeRuntimeStatus, NativeSessionState, RendererRecovery,
    RuntimeLaunchReason, RuntimePaths, SkinVerificationMode, DEFAULT_CDP_PORT,
    RENDERER_RECOVERY_GRACE,
};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

static OPERATION_LOCK: Mutex<()> = Mutex::new(());
static TEST_SUITE_LOCK: Mutex<()> = Mutex::new(());
static RUNTIME_LAUNCHING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy)]
enum ProbeResponse {
    Unavailable,
    Empty,
    OtherError,
}

struct Simulation {
    session: NativeSessionState,
    skin_installed: bool,
    skin_paused: bool,
    proxy_running: bool,
    enhancements_enabled: bool,
    running_executable: Option<PathBuf>,
    probe: ProbeResponse,
    write_fails: bool,
    launch_fails: bool,
    writes: usize,
    starts: usize,
    budget_spent_before_start: bool,
}

impl Default for Simulation {
    fn default() -> Self {
        let executable = PathBuf::from("simulated/ChatGPT.exe");
        let mut session = NativeSessionState::default();
        session.begin_launch(&executable, RuntimeLaunchReason::Explicit);
        session.session = NativeRuntimeStatus::Active;
        session.port = Some(DEFAULT_CDP_PORT);
        Self {
            session,
            skin_installed: true,
            skin_paused: false,
            proxy_running: false,
            enhancements_enabled: true,
            running_executable: Some(executable),
            probe: ProbeResponse::Unavailable,
            write_fails: false,
            launch_fails: false,
            writes: 0,
            starts: 0,
            budget_spent_before_start: false,
        }
    }
}

thread_local! {
    static SIMULATION: RefCell<Simulation> = RefCell::new(Simulation::default());
}

fn with_simulation<T>(operation: impl FnOnce(&mut Simulation) -> T) -> T {
    SIMULATION.with(|simulation| operation(&mut simulation.borrow_mut()))
}

fn reset_simulation() {
    with_simulation(|simulation| *simulation = Simulation::default());
    RUNTIME_LAUNCHING.store(false, Ordering::Release);
}

struct SimulatedPath(bool);

impl SimulatedPath {
    fn is_file(&self) -> bool {
        self.0
    }
}

fn marker_path() -> Result<SimulatedPath, String> {
    Ok(SimulatedPath(with_simulation(|simulation| {
        simulation.skin_installed
    })))
}

fn pause_path() -> Result<SimulatedPath, String> {
    Ok(SimulatedPath(with_simulation(|simulation| {
        simulation.skin_paused
    })))
}

fn runtime_proxy_running() -> bool {
    with_simulation(|simulation| simulation.proxy_running)
}

fn runtime_enhancements_enabled() -> bool {
    with_simulation(|simulation| simulation.proxy_running || simulation.enhancements_enabled)
}

fn read_session() -> NativeSessionState {
    with_simulation(|simulation| simulation.session.clone())
}

fn write_session(state: &NativeSessionState) -> Result<(), String> {
    with_simulation(|simulation| {
        simulation.writes += 1;
        if simulation.write_fails {
            return Err("simulated persistence failure".to_string());
        }
        simulation.session = state.clone();
        Ok(())
    })
}

fn find_running_codex_install() -> Option<CodexInstall> {
    with_simulation(|simulation| {
        simulation
            .running_executable
            .clone()
            .map(|executable| CodexInstall {
                executable,
                app_user_model_id: None,
            })
    })
}

fn same_install(left: &CodexInstall, right: &CodexInstall) -> bool {
    left.executable == right.executable
}

fn list_targets(_port: u16) -> Result<Vec<CdpTarget>, String> {
    with_simulation(|simulation| match simulation.probe {
        ProbeResponse::Unavailable => Err("CDP is unavailable: simulated outage".to_string()),
        ProbeResponse::Empty => Ok(Vec::new()),
        ProbeResponse::OtherError => Err("simulated malformed CDP response".to_string()),
    })
}

fn start_managed_runtime(
    _paths: &RuntimePaths,
    _install: &CodexInstall,
    mode: SkinVerificationMode,
    reason: RuntimeLaunchReason,
) -> Result<(), String> {
    assert!(mode == SkinVerificationMode::Background);
    assert!(reason == RuntimeLaunchReason::Recovery);
    with_simulation(|simulation| {
        simulation.starts += 1;
        simulation.budget_spent_before_start = simulation.session.recovery_attempted;
        if simulation.launch_fails {
            Err("simulated launch failure".to_string())
        } else {
            Ok(())
        }
    })
}

include!("runtime_recovery.rs");

fn runtime_paths() -> RuntimePaths {
    RuntimePaths {
        bundled_root: PathBuf::from("simulated/resources"),
        codex_paths: None,
    }
}

fn expected_install() -> CodexInstall {
    CodexInstall {
        executable: PathBuf::from("simulated/ChatGPT.exe"),
        app_user_model_id: None,
    }
}

fn recover(observed: &NativeSessionState) -> Result<(), String> {
    recover_running_codex(&runtime_paths(), observed, &expected_install())
}

fn assert_no_start_or_write() {
    with_simulation(|simulation| {
        assert_eq!(simulation.starts, 0);
        assert_eq!(simulation.writes, 0);
    });
}

#[test]
fn persistence_failure_prevents_starting_or_spending_an_unrecorded_attempt() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    let observed = read_session();
    with_simulation(|simulation| simulation.write_fails = true);
    assert!(recover(&observed).is_err());
    with_simulation(|simulation| {
        assert_eq!(simulation.starts, 0);
        assert_eq!(simulation.writes, 1);
        assert!(!simulation.session.recovery_attempted);
    });
}

#[test]
fn a_reused_port_in_a_new_launch_does_not_recover_the_old_observation() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    let observed = read_session();
    with_simulation(|simulation| {
        simulation.session.begin_launch(
            Path::new("simulated/ChatGPT.exe"),
            RuntimeLaunchReason::Explicit,
        );
        simulation.session.session = NativeRuntimeStatus::Active;
        simulation.session.port = observed.port;
    });
    recover(&observed).unwrap();
    assert_no_start_or_write();
}

#[test]
fn a_busy_operation_lock_skips_recovery_without_waiting() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    let observed = read_session();
    let _operation = OPERATION_LOCK.lock().unwrap();
    recover(&observed).unwrap();
    assert_no_start_or_write();
}

#[test]
fn conditions_are_rechecked_after_the_original_outage_observation() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    let changes: [fn(&mut Simulation); 7] = [
        |simulation| simulation.probe = ProbeResponse::Empty,
        |simulation| simulation.probe = ProbeResponse::OtherError,
        |simulation| simulation.skin_paused = true,
        |simulation| simulation.enhancements_enabled = false,
        |simulation| simulation.session.recovery_attempted = true,
        |simulation| simulation.running_executable = None,
        |simulation| simulation.running_executable = Some(PathBuf::from("updated/ChatGPT.exe")),
    ];
    for change in changes {
        reset_simulation();
        let observed = read_session();
        with_simulation(change);
        recover(&observed).unwrap();
        assert_no_start_or_write();
    }
}

#[test]
fn an_updated_installation_cannot_be_restarted_by_the_previous_session() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    let observed = read_session();
    let updated = CodexInstall {
        executable: PathBuf::from("updated/ChatGPT.exe"),
        app_user_model_id: None,
    };
    with_simulation(|simulation| simulation.running_executable = Some(updated.executable.clone()));
    // Both the initial observation and final process check can see the new
    // version. Matching those two checks alone does not establish ownership.
    recover_running_codex(&runtime_paths(), &observed, &updated).unwrap();
    assert_no_start_or_write();

    let mut recovery = RendererRecovery::default();
    for _ in 0..3 {
        recover_after_outage(&runtime_paths(), &observed, &mut recovery).unwrap();
        assert!(recovery.observed.is_none());
    }
    assert_no_start_or_write();
}

#[test]
fn success_and_failure_both_spend_the_budget_before_starting_and_never_retry() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    for launch_fails in [false, true] {
        reset_simulation();
        with_simulation(|simulation| simulation.launch_fails = launch_fails);
        let observed = read_session();
        assert_eq!(recover(&observed).is_err(), launch_fails);
        for _ in 0..60 {
            recover(&read_session()).unwrap();
        }
        with_simulation(|simulation| {
            assert_eq!(simulation.starts, 1);
            assert_eq!(simulation.writes, 1);
            assert!(simulation.budget_spent_before_start);
            assert!(simulation.session.recovery_attempted);
        });
    }
}

#[test]
fn repeated_outages_use_the_production_grace_gate_and_only_one_attempt() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    with_simulation(|simulation| simulation.launch_fails = true);
    let observed = read_session();
    let executable = Path::new("simulated/ChatGPT.exe");
    let mut recovery = RendererRecovery::default();
    recover_after_outage(&runtime_paths(), &observed, &mut recovery).unwrap();
    assert_no_start_or_write();
    recovery.reset();
    assert!(!recovery.outage_ready(
        &observed,
        executable,
        Instant::now() - RENDERER_RECOVERY_GRACE
    ));
    assert!(recover_after_outage(&runtime_paths(), &observed, &mut recovery).is_err());
    for _ in 0..60 {
        recover_after_outage(&runtime_paths(), &read_session(), &mut recovery).unwrap();
    }
    with_simulation(|simulation| {
        assert_eq!(simulation.starts, 1);
        assert_eq!(simulation.writes, 1);
    });
}

#[test]
fn paused_skin_only_recovers_when_proxy_is_running() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    with_simulation(|simulation| simulation.skin_paused = true);
    let observed = read_session();
    recover(&observed).unwrap();
    assert_no_start_or_write();
    with_simulation(|simulation| simulation.proxy_running = true);
    recover(&observed).unwrap();
    with_simulation(|simulation| assert_eq!(simulation.starts, 1));
}

#[test]
fn disabled_enhancements_do_not_block_proxy_recovery() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    with_simulation(|simulation| {
        simulation.enhancements_enabled = false;
        simulation.proxy_running = true;
    });
    recover(&read_session()).unwrap();
    with_simulation(|simulation| assert_eq!(simulation.starts, 1));
}

#[test]
fn launch_in_progress_does_not_enter_recovery_or_preserve_an_old_outage() {
    let _suite = TEST_SUITE_LOCK.lock().unwrap();
    reset_simulation();
    let observed = read_session();
    let mut recovery = RendererRecovery::default();
    assert!(!recovery.outage_ready(
        &observed,
        Path::new("simulated/ChatGPT.exe"),
        Instant::now() - RENDERER_RECOVERY_GRACE,
    ));
    RUNTIME_LAUNCHING.store(true, Ordering::Release);
    recover_after_outage(&runtime_paths(), &observed, &mut recovery).unwrap();
    assert_no_start_or_write();
    assert!(recovery.observed.is_none());
    RUNTIME_LAUNCHING.store(false, Ordering::Release);
}
