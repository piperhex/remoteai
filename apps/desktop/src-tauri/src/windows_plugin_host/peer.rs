//! Both ends must be this executable in the same logon session and at the same integrity level.
use super::{Error, Result};
use std::{
    mem::size_of,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::PathBuf,
    ptr,
};
use windows_sys::Win32::{Foundation::*, Security::*, System::Threading::*};

pub(in crate::windows_plugin_host) struct Peer(pub(in crate::windows_plugin_host) OwnedHandle);

impl Peer {
    pub(in crate::windows_plugin_host) fn open(pid: u32) -> Result<Self> {
        // Retain the kernel object across validation and duplication so PID reuse cannot change the peer.
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_DUP_HANDLE,
                0,
                pid,
            )
        };
        if raw.is_null() {
            return Err(Error::Unavailable);
        }
        let peer = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut buffer = [0u16; 32768];
        let mut length = buffer.len() as u32;
        // SAFETY: the live process handle and writable, sized UTF-16 buffer are valid throughout the query.
        if unsafe { QueryFullProcessImageNameW(raw, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return Err(Error::Unavailable);
        }
        let image = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
        let own = std::env::current_exe()
            .and_then(|path| path.canonicalize())
            .map_err(|_| Error::Unavailable)?;
        if image.canonicalize().map_err(|_| Error::Unavailable)? != own {
            return Err(Error::Unavailable);
        }
        // SAFETY: the current process pseudo-handle is borrowed, never closed.
        if identity(raw)? != identity(unsafe { GetCurrentProcess() })? {
            return Err(Error::Unavailable);
        }
        Ok(peer)
    }
}

fn identity(process: HANDLE) -> Result<(u32, i32, u32, u32)> {
    let mut raw = ptr::null_mut();
    // SAFETY: process is borrowed and valid; the token handle is returned into writable storage.
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 {
        return Err(Error::Unavailable);
    }
    let token = unsafe { OwnedHandle::from_raw_handle(raw) };
    let mut statistics = TOKEN_STATISTICS::default();
    let mut session = 0u32;
    let mut integrity = [0usize; 64];
    let mut length = 0;
    // SAFETY: each buffer is aligned and sized for the requested token information; the SID lives in integrity.
    unsafe {
        if GetTokenInformation(
            token.as_raw_handle(),
            TokenStatistics,
            (&mut statistics as *mut TOKEN_STATISTICS).cast(),
            size_of::<TOKEN_STATISTICS>() as u32,
            &mut length,
        ) == 0
            || GetTokenInformation(
                token.as_raw_handle(),
                TokenSessionId,
                (&mut session as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut length,
            ) == 0
            || GetTokenInformation(
                token.as_raw_handle(),
                TokenIntegrityLevel,
                integrity.as_mut_ptr().cast(),
                size_of_val(&integrity) as u32,
                &mut length,
            ) == 0
        {
            return Err(Error::Unavailable);
        }
        let label = &*integrity.as_ptr().cast::<TOKEN_MANDATORY_LABEL>();
        let count = *GetSidSubAuthorityCount(label.Label.Sid);
        if count == 0 {
            return Err(Error::Unavailable);
        }
        Ok((
            session,
            statistics.AuthenticationId.HighPart,
            statistics.AuthenticationId.LowPart,
            *GetSidSubAuthority(label.Label.Sid, u32::from(count - 1)),
        ))
    }
}
