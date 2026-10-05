//! Elevated, fixed-location installation. The service never executes files from the user's writable install tree.
use super::{configuration, platform, Result, ServiceError, NAME};
use std::{
    ffi::OsString,
    os::windows::fs::MetadataExt,
    path::Path,
    time::{Duration, Instant},
};
use windows_service::{
    service::{
        ServiceAccess, ServiceErrorControl, ServiceInfo, ServiceStartType, ServiceState,
        ServiceType,
    },
    service_manager::{ServiceManager, ServiceManagerAccess},
};

fn manager(create: bool) -> Result<ServiceManager> {
    let access = ServiceManagerAccess::CONNECT
        | if create {
            ServiceManagerAccess::CREATE_SERVICE
        } else {
            ServiceManagerAccess::empty()
        };
    ServiceManager::local_computer(None::<&str>, access).map_err(|_| ServiceError::Denied)
}
pub(super) fn query() -> Result<Option<windows_service::service::ServiceStatus>> {
    let manager = manager(false)?;
    match manager.open_service(NAME, ServiceAccess::QUERY_STATUS) {
        Ok(service) => service
            .query_status()
            .map(Some)
            .map_err(|_| ServiceError::Unavailable),
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
            Ok(None)
        }
        Err(_) => Err(ServiceError::Unavailable),
    }
}
fn stop() -> Result<()> {
    let manager = manager(false)?;
    let service =
        match manager.open_service(NAME, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP) {
            Ok(service) => service,
            Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
                return Ok(())
            }
            Err(_) => return Err(ServiceError::Denied),
        };
    if service
        .query_status()
        .map_err(|_| ServiceError::Unavailable)?
        .current_state
        == ServiceState::Stopped
    {
        return Ok(());
    }
    service.stop().map_err(|_| ServiceError::Unavailable)?;
    let until = Instant::now() + Duration::from_secs(30);
    while Instant::now() < until {
        if service
            .query_status()
            .map_err(|_| ServiceError::Unavailable)?
            .current_state
            == ServiceState::Stopped
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(ServiceError::Unavailable)
}
fn protect_directory(path: &Path) -> Result<()> {
    if path.exists()
        && std::fs::symlink_metadata(path)
            .map_err(|_| ServiceError::Storage)?
            .file_attributes()
            & 0x400
            != 0
    {
        return Err(ServiceError::Invalid);
    }
    std::fs::create_dir_all(path).map_err(|_| ServiceError::Storage)?;
    // Remove attacker-controlled ownership/explicit ACEs from any pre-created directory.
    set_acl(path, &["/setowner", "*S-1-5-32-544"])?;
    set_acl(path, &["/reset"])?;
    set_acl(
        path,
        &[
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
        ],
    )
}
fn set_acl(path: &Path, args: &[&str]) -> Result<()> {
    // Executable and all arguments are fixed/typed; no shell evaluates this command.
    let status = std::process::Command::new(platform::system_binary("icacls.exe")?)
        .arg(path)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| ServiceError::Storage)?;
    if status.success() {
        Ok(())
    } else {
        Err(ServiceError::Storage)
    }
}
fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    reject_link(destination)?;
    std::fs::create_dir_all(destination).map_err(|_| ServiceError::Storage)?;
    for entry in std::fs::read_dir(source).map_err(|_| ServiceError::Setup)? {
        let entry = entry.map_err(|_| ServiceError::Storage)?;
        let metadata =
            std::fs::symlink_metadata(entry.path()).map_err(|_| ServiceError::Storage)?;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(ServiceError::Invalid);
        }
        let target = destination.join(entry.file_name());
        reject_link(&target)?;
        if metadata.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target).map_err(|_| ServiceError::Storage)?;
        }
    }
    Ok(())
}
fn reject_link(path: &Path) -> Result<()> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(ServiceError::Invalid);
        }
    }
    Ok(())
}

pub(super) fn install(prepared: &Path) -> Result<()> {
    if !platform::elevated()? {
        return Err(ServiceError::Denied);
    }
    let metadata = std::fs::metadata(prepared).map_err(|_| ServiceError::Invalid)?;
    if metadata.len() > 64 * 1024 || !metadata.is_file() {
        return Err(ServiceError::Invalid);
    }
    let config =
        configuration::unseal(&std::fs::read(prepared).map_err(|_| ServiceError::Storage)?)?;
    let executable = std::env::current_exe().map_err(|_| ServiceError::Setup)?;
    let source = executable.parent().ok_or(ServiceError::Setup)?;
    super::assets::verify(source)?;
    for relative in [
        "resources/desktop-service/node.exe",
        "resources/desktop-service/host.mjs",
        "resources/remote-desktop/runtime/desktop-video.exe",
    ] {
        if !source.join(relative).is_file() {
            return Err(ServiceError::Setup);
        }
    }
    stop()?;
    let previous = configuration::read().ok();
    let root = configuration::install_root()?;
    let data = configuration::data_root()?;
    protect_directory(&root)?;
    protect_directory(&data)?;
    std::fs::copy(&executable, root.join("csw.exe")).map_err(|_| ServiceError::Storage)?;
    copy_tree(
        &source.join("resources/desktop-service"),
        &root.join("resources/desktop-service"),
    )?;
    copy_tree(
        &source.join("resources/remote-desktop"),
        &root.join("resources/remote-desktop"),
    )?;
    configuration::write(&config)?;
    super::assets::verify(&root)?;
    register(&root)?;
    if let Some(previous) = previous.filter(|previous| previous.credential != config.credential) {
        if super::setup::revoke(&previous).is_err() {
            eprintln!("previous desktop service credential revocation pending");
        }
    }
    Ok(())
}
fn register(root: &Path) -> Result<()> {
    let manager = manager(true)?;
    let info = ServiceInfo {
        name: OsString::from(NAME),
        display_name: OsString::from("Remote AI Desktop"),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: root.join("csw.exe"),
        launch_arguments: vec![OsString::from("--remote-desktop-service")],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };
    let access = ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::QUERY_STATUS;
    let service = match manager.open_service(NAME, access) {
        Ok(service) => {
            service
                .change_config(&info)
                .map_err(|_| ServiceError::Setup)?;
            service
        }
        Err(_) => manager
            .create_service(&info, access)
            .map_err(|_| ServiceError::Setup)?,
    };
    service
        .set_description("Allows this computer's owner to use remote desktop before signing in.")
        .map_err(|_| ServiceError::Setup)?;
    recovery(&service)?;
    service
        .start::<&str>(&[])
        .map_err(|_| ServiceError::Unavailable)?;
    let until = Instant::now() + Duration::from_secs(20);
    while Instant::now() < until {
        match service
            .query_status()
            .map_err(|_| ServiceError::Unavailable)?
            .current_state
        {
            ServiceState::Running => return Ok(()),
            ServiceState::Stopped => return Err(ServiceError::Unavailable),
            _ => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    Err(ServiceError::Unavailable)
}

fn recovery(service: &windows_service::service::Service) -> Result<()> {
    use windows_service::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
    };
    service
        .update_failure_actions(ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86400)),
            reboot_msg: None,
            command: None,
            actions: Some(
                [5, 15, 60]
                    .into_iter()
                    .map(|seconds| ServiceAction {
                        action_type: ServiceActionType::Restart,
                        delay: Duration::from_secs(seconds),
                    })
                    .collect(),
            ),
        })
        .map_err(|_| ServiceError::Setup)?;
    service
        .set_failure_actions_on_non_crash_failures(true)
        .map_err(|_| ServiceError::Setup)
}

pub(super) fn uninstall() -> Result<()> {
    if !platform::elevated()? {
        return Err(ServiceError::Denied);
    }
    stop()?;
    let revocation_pending =
        configuration::read().is_ok_and(|config| super::setup::revoke(&config).is_err());
    let manager = manager(false)?;
    match manager.open_service(NAME, ServiceAccess::DELETE) {
        Ok(service) => service.delete().map_err(|_| ServiceError::Unavailable)?,
        Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {}
        Err(_) => return Err(ServiceError::Denied),
    }
    for root in [configuration::install_root()?, configuration::data_root()?] {
        if !root.exists() {
            continue;
        }
        // Refuse junctions and verify the final resolved path remains the exact app-owned installation directory.
        let resolved = std::fs::canonicalize(&root).map_err(|_| ServiceError::Storage)?;
        let expected = std::fs::canonicalize(root.parent().ok_or(ServiceError::Invalid)?)
            .map_err(|_| ServiceError::Storage)?
            .join(root.file_name().ok_or(ServiceError::Invalid)?);
        if resolved != expected {
            return Err(ServiceError::Invalid);
        }
        std::fs::remove_dir_all(&resolved).map_err(|_| ServiceError::Storage)?;
    }
    if revocation_pending {
        Err(ServiceError::RevocationPending)
    } else {
        Ok(())
    }
}
