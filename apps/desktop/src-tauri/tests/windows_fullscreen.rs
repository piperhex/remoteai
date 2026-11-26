//! Verify the physical client area that WebView2 receives on a maximized Windows desktop.
#![cfg(windows)]

use tao::{
    event_loop::EventLoopBuilder,
    platform::windows::EventLoopBuilderExtWindows,
    window::{Fullscreen, WindowBuilder},
};

#[test]
fn maximized_borderless_window_fills_monitor_and_restores_client_area() {
    let event_loop = EventLoopBuilder::<()>::new().with_any_thread(true).build();
    let window = WindowBuilder::new()
        .with_title("Remote AI fullscreen regression")
        .with_decorations(false)
        .with_focused(false)
        .build(&event_loop)
        .unwrap();
    window.set_maximized(true);
    assert!(window.is_maximized());
    let maximized = (window.inner_position().unwrap(), window.inner_size());
    let monitor = window.current_monitor().unwrap();

    window.set_fullscreen(Some(Fullscreen::Borderless(None)));
    assert_eq!(window.inner_position().unwrap(), monitor.position());
    assert_eq!(window.inner_size(), monitor.size());

    window.set_fullscreen(None);
    assert!(window.is_maximized());
    assert_eq!(
        (window.inner_position().unwrap(), window.inner_size()),
        maximized
    );
}
