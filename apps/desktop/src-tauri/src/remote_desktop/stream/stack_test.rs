//! IPC futures are constructed on the Windows UI thread before Tauri moves them to Tokio.
use std::{future::Future, mem::size_of};

const MAX_IPC_FUTURE_BYTES: usize = 16 * 1024;
const WINDOWS_UI_STACK_BYTES: usize = 1024 * 1024;

fn future_size<A, B, F: Future>(_: impl Fn(A, B) -> F) -> usize {
    size_of::<F>()
}

#[test]
fn desktop_open_futures_fit_the_windows_ui_stack() {
    let sizes = [
        (
            "command",
            future_size(super::remote_desktop_stream_open::<tauri::Wry>),
        ),
        ("session", future_size(super::open_at)),
        ("stream", future_size(super::native::Stream::open)),
        (
            "peer",
            future_size(|servers, clipboard| {
                super::peer::create_codec(servers, clipboard, super::codec::VideoCodec::H264)
            }),
        ),
        (
            "signal",
            future_size(|request, ()| super::remote_desktop_stream_signal(request)),
        ),
    ];
    for (name, size) in sizes {
        println!("desktop {name} future: {size} bytes");
    }
    assert!(
        sizes.iter().all(|(_, size)| *size <= MAX_IPC_FUTURE_BYTES),
        "nested desktop futures exhaust the Windows UI stack before runtime dispatch: {sizes:?}"
    );
}

#[test]
fn desktop_ipc_dispatch_survives_a_windows_sized_ui_stack() {
    // Exercise generated Tauri dispatch too: release builds move the future through
    // several unboxed wrappers before spawning it. Testing Stream::open alone misses that.
    std::thread::Builder::new()
        .name("desktop-ipc-small-stack".into())
        .stack_size(WINDOWS_UI_STACK_BYTES)
        .spawn(dispatch_expired_requests)
        .unwrap()
        .join()
        .unwrap();
}

fn dispatch_expired_requests() {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            super::remote_desktop_stream_open,
            super::remote_desktop_stream_signal
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for _ in 0..4 {
        for (command, request) in [
            (
                "remote_desktop_stream_open",
                serde_json::json!({
                    "id": "expired-stack-regression", "iceServers": [],
                    "profile": {"width": 1280, "fps": 30, "bitrate": 2_000_000}
                }),
            ),
            (
                "remote_desktop_stream_signal",
                serde_json::json!({
                    "id": "expired-stack-regression", "candidates": []
                }),
            ),
        ] {
            let response = tauri::test::get_ipc_response(&window, ipc_request(command, request));
            assert_eq!(
                response.unwrap_err(),
                serde_json::json!("桌面连接已结束，请重新连接。")
            );
        }
    }
}

fn ipc_request(command: &str, request: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: command.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(serde_json::json!({"request": request})),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    }
}
