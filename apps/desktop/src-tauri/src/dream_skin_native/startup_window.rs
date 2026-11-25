/// A running renderer can belong to a hidden window retained after closing to the tray.
#[derive(Clone, Copy, PartialEq, Eq)]
enum StartupWindow {
    Pending,
    Hidden,
    Visible,
}

fn is_workspace_page(value: &str) -> bool {
    value.split(['?', '#']).next() == Some("app://-/index.html") && is_skin_surface_url(value)
}

fn startup_window(port: u16) -> Result<StartupWindow, String> {
    let mut found_hidden = false;
    let mut unknown = false;
    for target in list_targets(port)?
        .iter()
        .filter(|page| is_workspace_page(&page.url))
    {
        let visibility = CdpSession::connect(target, port).and_then(|mut session| {
            session.send_with_timeout(
                "Runtime.evaluate",
                json!({ "expression": "document.visibilityState", "returnByValue": true }),
                Duration::from_secs(1),
            )
        });
        match visibility
            .as_ref()
            .ok()
            .and_then(|v| v.pointer("/result/value"))
            .and_then(Value::as_str)
        {
            Some("visible") => return Ok(StartupWindow::Visible),
            Some("hidden") => found_hidden = true,
            _ => unknown = true,
        }
    }
    Ok(if found_hidden && !unknown {
        StartupWindow::Hidden
    } else {
        StartupWindow::Pending
    })
}

fn hidden_window_needs_activation(
    hidden_since: &mut Option<Instant>,
    state: StartupWindow,
    now: Instant,
) -> bool {
    if state != StartupWindow::Hidden {
        *hidden_since = None;
        return false;
    }
    now.duration_since(*hidden_since.get_or_insert(now)) >= Duration::from_secs(3)
}

fn wait_for_startup_window(
    port: u16,
    timeout: Duration,
    reactivate: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut reactivate = Some(reactivate);
    let mut hidden_since = None;
    while Instant::now() < deadline {
        let state = startup_window(port).unwrap_or(StartupWindow::Pending);
        if state == StartupWindow::Visible
            || (cfg!(target_os = "macos") && state == StartupWindow::Hidden)
        {
            return Ok(());
        }
        if hidden_window_needs_activation(&mut hidden_since, state, Instant::now()) {
            if let Some(activate) = reactivate.take() {
                activate()?;
            }
        }
        thread::sleep(Duration::from_millis(300));
    }
    Err(crate::client_lifecycle::ClientOperationError::TimedOut.to_string())
}

#[cfg(test)]
mod startup_window_tests {
    use super::*;

    #[test]
    fn only_workspace_pages_count_as_startup() {
        assert!(is_workspace_page("app://-/index.html"));
        assert!(is_workspace_page("app://-/index.html?initialRoute=%2Fhome"));
        for url in [
            "app://-/index.html?initialRoute=%2Favatar-overlay",
            "app://-/overlay.html",
            "https://example.com/index.html",
            "app://fs/index.html",
        ] {
            assert!(!is_workspace_page(url), "{url}");
        }
    }

    #[test]
    fn reactivation_requires_a_continuous_hidden_window() {
        let mut since = None;
        let now = Instant::now();
        let later = now + Duration::from_secs(4);
        assert!(!hidden_window_needs_activation(
            &mut since,
            StartupWindow::Hidden,
            now
        ));
        assert!(!hidden_window_needs_activation(
            &mut since,
            StartupWindow::Pending,
            later
        ));
        assert!(!hidden_window_needs_activation(
            &mut since,
            StartupWindow::Hidden,
            later
        ));
        assert!(hidden_window_needs_activation(
            &mut since,
            StartupWindow::Hidden,
            later + Duration::from_secs(4)
        ));
        assert!(!hidden_window_needs_activation(
            &mut since,
            StartupWindow::Visible,
            later + Duration::from_secs(5)
        ));
    }
}
