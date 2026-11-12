use super::{Error, Request, Result};
use std::{
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr,
};
use windows_sys::Win32::{
    Foundation::*,
    Storage::FileSystem::{GetFileType, FILE_TYPE_PIPE},
    System::{Console::*, JobObjects::*, Threading::*},
};

#[path = "peer.rs"]
mod peer;
pub(super) use peer::Peer;

pub(super) struct Worker {
    process: OwnedHandle,
    _job: OwnedHandle,
}

impl Worker {
    pub(super) fn alive(&self) -> bool {
        // SAFETY: this object retains the process handle throughout the nonblocking query.
        unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) == WAIT_TIMEOUT }
    }
}

pub(super) fn standard_streams() -> Result<[usize; 3]> {
    // SAFETY: GetStdHandle has no pointer inputs. Invalid handles are rejected before transfer.
    let handles = unsafe {
        [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ]
    };
    if handles
        .iter()
        .any(|handle| handle.is_null() || *handle == INVALID_HANDLE_VALUE)
    {
        return Err(Error::Unavailable);
    }
    Ok(handles.map(|handle| handle as usize))
}

fn duplicate(peer: &Peer, handle: usize) -> Result<OwnedHandle> {
    let mut copied = ptr::null_mut();
    // SAFETY: only the authenticated process's handles can be duplicated. The returned handle is uniquely owned.
    if unsafe {
        DuplicateHandle(
            peer.0.as_raw_handle(),
            handle as HANDLE,
            GetCurrentProcess(),
            &mut copied,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(Error::Unavailable);
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(copied) })
}

fn job() -> Result<OwnedHandle> {
    // SAFETY: null security attributes create a private noninheritable job owned by this host.
    let raw = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if raw.is_null() {
        return Err(Error::Unavailable);
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: limits has the layout and size required by this information class.
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(Error::Unavailable);
    }
    Ok(job)
}

struct Attributes(Vec<usize>);
impl Attributes {
    fn new(handles: &mut [HANDLE; 3]) -> Result<Self> {
        let mut size = 0;
        // SAFETY: the initial null query obtains the allocation size; no attribute list is read.
        unsafe {
            InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut size);
        }
        if size == 0 {
            return Err(Error::Unavailable);
        }
        let mut value = Self(vec![0; size.div_ceil(size_of::<usize>())]);
        // SAFETY: the aligned allocation lives until after process creation and has the queried size.
        if unsafe { InitializeProcThreadAttributeList(value.pointer(), 1, 0, &mut size) } == 0 {
            // Failed initialization must not run DeleteProcThreadAttributeList.
            value.0.clear();
            return Err(Error::Unavailable);
        }
        // Inherit only these streams; the app's other pipes, credentials and job handles stay private.
        if unsafe {
            UpdateProcThreadAttribute(
                value.pointer(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_mut_ptr().cast(),
                size_of_val(handles),
                ptr::null_mut(),
                ptr::null(),
            )
        } == 0
        {
            return Err(Error::Unavailable);
        }
        Ok(value)
    }
    fn pointer(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            // SAFETY: only successfully initialized lists reach this path; storage outlives deletion.
            unsafe {
                DeleteProcThreadAttributeList(self.pointer());
            }
        }
    }
}

pub(super) fn spawn(peer: &Peer, request: &Request) -> Result<Worker> {
    let streams = [
        duplicate(peer, request.streams[0])?,
        duplicate(peer, request.streams[1])?,
        duplicate(peer, request.streams[2])?,
    ];
    // A handoff is only valid for a piped MCP transport, never a console or arbitrary file transport.
    if streams[..2]
        .iter()
        .any(|stream| unsafe { GetFileType(stream.as_raw_handle()) } != FILE_TYPE_PIPE)
    {
        return Err(Error::Unavailable);
    }
    let mut handles = streams.each_ref().map(AsRawHandle::as_raw_handle);
    let mut attributes = Attributes::new(&mut handles)?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    [
        startup.StartupInfo.hStdInput,
        startup.StartupInfo.hStdOutput,
        startup.StartupInfo.hStdError,
    ] = handles;
    startup.lpAttributeList = attributes.pointer();
    let job = job()?;
    let (process, thread) = create(&request.argument, &startup)?;
    // Assign while suspended so even a very fast worker cannot launch a descendant outside the job.
    let ready = unsafe {
        AssignProcessToJobObject(job.as_raw_handle(), process.as_raw_handle()) != 0
            && ResumeThread(thread.as_raw_handle()) != u32::MAX
    };
    if !ready {
        // A suspended process cannot handle graceful shutdown; terminate it before releasing its handle.
        unsafe {
            TerminateProcess(process.as_raw_handle(), 1);
            WaitForSingleObject(process.as_raw_handle(), 5000);
        }
        return Err(Error::Unavailable);
    }
    Ok(Worker { process, _job: job })
}

fn create(argument: &str, startup: &STARTUPINFOEXW) -> Result<(OwnedHandle, OwnedHandle)> {
    let executable = std::env::current_exe().map_err(|_| Error::Unavailable)?;
    let mut command: Vec<u16> = format!(
        "\"{}\" {argument} {}",
        executable.display(),
        super::WORKER_ARGUMENT
    )
    .encode_utf16()
    .chain(Some(0))
    .collect();
    let executable: Vec<u16> = executable
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut information = PROCESS_INFORMATION::default();
    // SAFETY: executable and command are NUL terminated; startup's stream list remains alive until return.
    let created = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            CREATE_NO_WINDOW | CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT,
            ptr::null(),
            ptr::null(),
            &startup.StartupInfo,
            &mut information,
        )
    };
    if created == 0 {
        return Err(Error::Unavailable);
    }
    // SAFETY: a successful CreateProcessW transfers two distinct, valid handles to this caller.
    Ok(unsafe {
        (
            OwnedHandle::from_raw_handle(information.hProcess),
            OwnedHandle::from_raw_handle(information.hThread),
        )
    })
}
