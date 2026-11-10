//! Keep shell descendants within the lifetime of a CLI session worker.
use super::{Error, Result};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use tokio::process::Child;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub(super) fn track(child: &Child) -> Result<OwnedHandle> {
    let process = child.raw_handle().ok_or(Error::Startup)?;
    // SAFETY: null attributes create a noninheritable, unnamed job. Its non-null handle has one owner.
    let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if raw.is_null() {
        return Err(Error::Startup);
    }
    // SAFETY: CreateJobObjectW returned a valid uniquely owned handle, closed by OwnedHandle on every path.
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: the job and child handles remain alive for these calls; limits has the required C layout and size.
    let configured = unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        ) != 0
            && AssignProcessToJobObject(job.as_raw_handle(), process) != 0
    };
    if !configured {
        return Err(Error::Startup);
    }
    Ok(job)
}
