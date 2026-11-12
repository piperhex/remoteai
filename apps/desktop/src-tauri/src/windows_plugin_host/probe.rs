//! Debug-only integration fixture: exercise real Codex and real plugins without restarting the user's GUI.
use super::{Error, Host, Result};
use std::{path::Path, process::Stdio};

pub(crate) fn run() -> bool {
    let Some(home) = std::env::args()
        .nth(1)
        .and_then(|arg| arg.strip_prefix("--plugin-host-probe=").map(str::to_owned))
    else {
        return false;
    };
    let result = tauri::async_runtime::block_on(async {
        let executable = std::env::args().nth(2).ok_or(Error::Unavailable)?;
        let host = Host::start(Path::new(&home))?;
        let mut command = tokio::process::Command::new(executable);
        command
            .arg("app-server")
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        host.configure(&mut command);
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        let mut engine = command.spawn().map_err(|_| Error::Unavailable)?;
        show_window()?;
        eprintln!(
            "plugin-host-probe owner={} engine={}",
            std::process::id(),
            engine.id().unwrap_or(0)
        );
        engine.wait().await.map_err(|_| Error::Unavailable)?;
        host.stop();
        Ok::<_, Error>(())
    });
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
    true
}

fn show_window() -> Result<()> {
    std::thread::Builder::new()
        .name("plugin-host-probe-window".into())
        .spawn(|| {
            use windows_sys::Win32::UI::WindowsAndMessaging::*;
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let title: Vec<u16> = "Remote AI plugin grouping verification\0"
                .encode_utf16()
                .collect();
            // SAFETY: STATIC is a system class; the window and message loop belong to this dedicated thread.
            unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    80,
                    80,
                    620,
                    180,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                );
                let mut message = MSG::default();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        })
        .map_err(|_| Error::Unavailable)?;
    Ok(())
}
