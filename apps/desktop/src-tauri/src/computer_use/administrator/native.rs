//! Small Windows primitives for the consented CUA broker, never a SYSTEM service.
use super::super::{ComputerError, Result};
use std::{
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    ptr,
};
use windows_sys::Win32::{Foundation::*, Security::*, System::Threading::*};

pub(super) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

pub(super) struct Process(pub OwnedHandle);

impl Process {
    pub(super) fn open(pid: u32) -> Result<Self> {
        // Keep the process object open so PID reuse cannot extend an authorization.
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        if raw.is_null() {
            return Err(ComputerError::Administrator);
        }
        Ok(Self(unsafe { OwnedHandle::from_raw_handle(raw) }))
    }

    pub(super) fn alive(&self) -> bool {
        unsafe { WaitForSingleObject(self.0.as_raw_handle(), 0) == WAIT_TIMEOUT }
    }

    pub(super) fn wait(&self) -> Result<()> {
        // Used only by the dedicated watcher thread; this never waits on the UI thread.
        if unsafe { WaitForSingleObject(self.0.as_raw_handle(), INFINITE) } != WAIT_OBJECT_0 {
            return Err(ComputerError::Administrator);
        }
        Ok(())
    }

    pub(super) fn started(&self) -> Result<u64> {
        let (mut creation, mut exit, mut kernel, mut user) = Default::default();
        if unsafe {
            GetProcessTimes(
                self.0.as_raw_handle(),
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        } == 0
        {
            return Err(ComputerError::Administrator);
        }
        Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
    }

    pub(super) fn trusted(&self) -> Result<()> {
        let mut buffer = [0u16; 32768];
        let mut length = buffer.len() as u32;
        if unsafe {
            QueryFullProcessImageNameW(self.0.as_raw_handle(), 0, buffer.as_mut_ptr(), &mut length)
        } == 0
        {
            return Err(ComputerError::Administrator);
        }
        let path = std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
        let own = std::env::current_exe().map_err(|_| ComputerError::Administrator)?;
        if path.canonicalize().ok() != own.canonicalize().ok() || path.canonicalize().is_err() {
            return Err(ComputerError::Administrator);
        }
        let token = self.token()?;
        let current = Self::open(std::process::id())?.token()?;
        if identity(&token)? != identity(&current)? {
            return Err(ComputerError::Administrator);
        }
        Ok(())
    }

    pub(super) fn elevated(&self) -> Result<bool> {
        let token = self.token()?;
        let mut info: TOKEN_ELEVATION = Default::default();
        let mut length = 0;
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenElevation,
                (&mut info as *mut TOKEN_ELEVATION).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut length,
            )
        } == 0
        {
            return Err(ComputerError::Administrator);
        }
        Ok(info.TokenIsElevated != 0)
    }

    fn token(&self) -> Result<OwnedHandle> {
        let mut raw = ptr::null_mut();
        if unsafe { OpenProcessToken(self.0.as_raw_handle(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err(ComputerError::Administrator);
        }
        Ok(unsafe { OwnedHandle::from_raw_handle(raw) })
    }
}

fn identity(token: &OwnedHandle) -> Result<(String, u32)> {
    let mut buffer = [0usize; 64];
    let mut length = 0;
    let mut session = 0u32;
    let mut text = ptr::null_mut();
    // The aligned buffer contains TOKEN_USER and its SID until conversion completes.
    unsafe {
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size_of::<[usize; 64]>() as u32,
            &mut length,
        ) == 0
            || GetTokenInformation(
                token.as_raw_handle(),
                TokenSessionId,
                (&mut session as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut length,
            ) == 0
        {
            return Err(ComputerError::Administrator);
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        if Authorization::ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return Err(ComputerError::Administrator);
        }
        let mut size = 0;
        while *text.add(size) != 0 && size < 184 {
            size += 1;
        }
        let sid = String::from_utf16(std::slice::from_raw_parts(text, size));
        LocalFree(text.cast());
        Ok((sid.map_err(|_| ComputerError::Administrator)?, session))
    }
}

pub(super) fn user_acl() -> Result<String> {
    let token = Process::open(std::process::id())?.token()?;
    let (sid, session) = identity(&token)?;
    if session == 0 {
        return Err(ComputerError::Administrator);
    }
    // The explicitly authorized medium-integrity host must be able to write to its high-integrity broker.
    Ok(format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})S:(ML;;NW;;;ME)"))
}

pub(super) fn elevate(argument: &str) -> Result<Process> {
    use windows_sys::Win32::UI::{Shell::*, WindowsAndMessaging::SW_HIDE};
    let executable = std::env::current_exe().map_err(|_| ComputerError::Administrator)?;
    let file = wide(&executable.to_string_lossy());
    let verb = wide("runas");
    let parameters = wide(argument);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    // Only our fixed helper flag, UUID and numeric PID are passed, never a shell command.
    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        return Err(ComputerError::Administrator);
    }
    Ok(Process(unsafe {
        OwnedHandle::from_raw_handle(info.hProcess)
    }))
}

pub(super) fn pid(process: &Process) -> u32 {
    unsafe { GetProcessId(process.0.as_raw_handle()) }
}
