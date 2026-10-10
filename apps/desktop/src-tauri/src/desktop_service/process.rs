//! A job-owned SYSTEM worker in the physical console session, without an interactive window.
use super::{configuration, platform, Result, ServiceError};
use std::{
    mem::{size_of, size_of_val},
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr,
};
use windows_sys::Win32::{
    Foundation::*,
    Security::*,
    System::{JobObjects::*, Threading::*},
};

pub(super) struct WorkerProcess {
    _process: OwnedHandle,
    _job: OwnedHandle,
    pub id: u32,
    pub session: u32,
}

fn privilege(token: &OwnedHandle, name: &str) -> Result<()> {
    let name = platform::wide(name);
    let mut luid = LUID {
        LowPart: 0,
        HighPart: 0,
    };
    // SAFETY: all pointers refer to live initialized structures for these synchronous token operations.
    unsafe {
        if LookupPrivilegeValueW(ptr::null(), name.as_ptr(), &mut luid) == 0 {
            return Err(ServiceError::Denied);
        }
        let privileges = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };
        SetLastError(0);
        if AdjustTokenPrivileges(
            token.as_raw_handle(),
            0,
            &privileges,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        ) == 0
            || GetLastError() != 0
        {
            return Err(ServiceError::Denied);
        }
    }
    Ok(())
}

fn session_token(session: u32) -> Result<OwnedHandle> {
    let token = platform::token()?;
    for name in [
        "SeTcbPrivilege",
        "SeAssignPrimaryTokenPrivilege",
        "SeIncreaseQuotaPrivilege",
    ] {
        privilege(&token, name)?;
    }
    let mut duplicate = ptr::null_mut();
    // SAFETY: DuplicateTokenEx creates a new owned token; the input token lives until this function returns.
    if unsafe {
        DuplicateTokenEx(
            token.as_raw_handle(),
            TOKEN_ALL_ACCESS,
            ptr::null(),
            SecurityImpersonation,
            TokenPrimary,
            &mut duplicate,
        )
    } == 0
    {
        return Err(ServiceError::Denied);
    }
    // SAFETY: duplicate is the new handle returned by the successful call above.
    let duplicate = unsafe { OwnedHandle::from_raw_handle(duplicate) };
    // SAFETY: session points to a valid session ID for the synchronous token update.
    if unsafe {
        SetTokenInformation(
            duplicate.as_raw_handle(),
            TokenSessionId,
            (&session as *const u32).cast(),
            4,
        )
    } == 0
    {
        return Err(ServiceError::Denied);
    }
    Ok(duplicate)
}

fn job(allow_guardian: bool) -> Result<OwnedHandle> {
    // SAFETY: no named object or inherited handle is requested; this process owns the returned job.
    let raw = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if raw.is_null() {
        return Err(ServiceError::Unavailable);
    }
    // SAFETY: CreateJobObjectW returned a new owned handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = Default::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if allow_guardian {
        // Only the interactive capture worker may explicitly launch a recovery guardian outside
        // the job. All ordinary children remain contained; this is not SILENT_BREAKAWAY_OK.
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
    }
    // SAFETY: limits is an initialized structure with the exact size required by this information class.
    if unsafe {
        SetInformationJobObject(
            handle.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(ServiceError::Unavailable);
    }
    Ok(handle)
}

/// Keeps the connection host from surviving an abrupt supervisor exit with a live device credential.
pub(super) fn contain(process: std::os::windows::io::RawHandle) -> Result<OwnedHandle> {
    let job = job(false)?;
    // SAFETY: the caller retains its child process while this job owns its lifetime; the handle is borrowed.
    if unsafe { AssignProcessToJobObject(job.as_raw_handle(), process) } == 0 {
        return Err(ServiceError::Unavailable);
    }
    Ok(job)
}

pub(super) fn spawn(session: u32, pipe: &str) -> Result<WorkerProcess> {
    if !platform::is_system()? || !platform::valid_pipe(pipe) {
        return Err(ServiceError::Denied);
    }
    let token = session_token(session)?;
    let job = job(true)?;
    let root = configuration::install_root()?;
    let executable = platform::wide(&root.join("csw.exe").to_string_lossy());
    let mut arguments = platform::wide(&format!(
        "\"{}\" --remote-desktop-worker {pipe}",
        root.join("csw.exe").display()
    ));
    let mut desktop = platform::wide(r"winsta0\default");
    let directory = platform::wide(&root.to_string_lossy());
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        lpDesktop: desktop.as_mut_ptr(),
        ..Default::default()
    };
    let mut information: PROCESS_INFORMATION = Default::default();
    // SAFETY: fixed app-owned paths/arguments are NUL terminated; no handles are inherited across sessions.
    if unsafe {
        CreateProcessAsUserW(
            token.as_raw_handle(),
            executable.as_ptr(),
            arguments.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            CREATE_NO_WINDOW | CREATE_SUSPENDED,
            ptr::null(),
            directory.as_ptr(),
            &startup,
            &mut information,
        )
    } == 0
    {
        return Err(ServiceError::Unavailable);
    }
    // SAFETY: the successful process creation returned two independently owned handles.
    let process = unsafe { OwnedHandle::from_raw_handle(information.hProcess) };
    // SAFETY: hThread is the distinct owned primary-thread handle returned by CreateProcessAsUserW.
    let thread = unsafe { OwnedHandle::from_raw_handle(information.hThread) };
    // SAFETY: the child is suspended and belongs to this supervisor; assign the cleanup job before running it.
    unsafe {
        if AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) == 0 {
            if TerminateProcess(process.as_raw_handle(), 1) == 0 {
                eprintln!("desktop worker cleanup failed");
            }
            return Err(ServiceError::Unavailable);
        }
        if ResumeThread(thread.as_raw_handle()) == u32::MAX {
            return Err(ServiceError::Unavailable);
        }
    }
    Ok(WorkerProcess {
        _process: process,
        _job: job,
        id: information.dwProcessId,
        session,
    })
}
