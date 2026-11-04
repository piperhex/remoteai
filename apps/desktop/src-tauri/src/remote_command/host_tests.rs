use super::super::protocol::Shell;
use super::*;
use std::{
    fs,
    path::Path,
    thread,
    time::{Duration, Instant},
};

struct Fixture {
    root: PathBuf,
    id: String,
    token: String,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("csw-command-host-{}", uuid::Uuid::new_v4()));
        let record = state::Record {
            home: root.join("home"),
            token: "host-test-token".into(),
            enabled: true,
        };
        state::save(&root, &record).unwrap();
        Self {
            id: state::home_id(&record.home),
            token: record.token,
            root,
        }
    }
    fn grant(&self) -> Grant {
        Ok((self.root.clone(), self.id.clone(), self.token.clone()))
    }
    fn request(&self, id: &str) -> CommandRequest {
        let ready = self.root.join(format!("ready-{id}"));
        let release = self.root.join(format!("release-{id}"));
        let command = if cfg!(windows) {
            format!("Set-Content -LiteralPath '{}' -Value ready; while (!(Test-Path -LiteralPath '{}')) {{ Start-Sleep -Milliseconds 100 }}; Write-Output '{id}'",
                ready.display(), release.display())
        } else {
            format!(
                "touch '{}'; while [ ! -f '{}' ]; do sleep 0.1; done; echo '{id}'",
                ready.display(),
                release.display()
            )
        };
        CommandRequest {
            command,
            cwd: None,
            shell: Shell::Auto,
            timeout_seconds: 60,
        }
    }
    fn release(&self, id: &str) {
        fs::write(self.root.join(format!("release-{id}")), "").unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn wait_until(check: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(35);
    while !check() {
        assert!(
            Instant::now() < deadline,
            "controlled command did not reach expected state"
        );
        thread::sleep(Duration::from_millis(30));
    }
}
fn wait_reply(host: &mut CommandHost) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let replies = host.responses();
        if !replies.is_empty() {
            return replies;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(30));
    }
}
fn started(root: &Path, id: usize) -> bool {
    root.join(format!("ready-{id}")).exists()
}

#[test]
fn real_commands_overlap_route_results_and_cancel_without_losing_slots() {
    for limit in [5, 8] {
        let fixture = Fixture::new();
        let mut host = CommandHost::new();
        for index in 0..limit {
            let id = index.to_string();
            assert!(host
                .request_with_grant(id.clone(), fixture.request(&id), (limit, fixture.grant()))
                .is_none());
        }
        wait_until(|| (0..limit).all(|id| started(&fixture.root, id)));
        assert_eq!(EXECUTING.load(Ordering::Acquire), limit);
        let mut replacement = CommandHost::new();
        assert!(replacement
            .request_with_grant(
                "replacement".into(),
                fixture.request("replacement"),
                (limit, fixture.grant())
            )
            .unwrap()["error"]
            .is_string());
        assert!(host
            .request_with_grant(
                "overflow".into(),
                fixture.request("overflow"),
                (limit, fixture.grant())
            )
            .unwrap()["error"]
            .is_string());
        assert!(host
            .request_with_grant(
                "lower".into(),
                fixture.request("lower"),
                (1, fixture.grant())
            )
            .unwrap()["error"]
            .is_string());
        assert_eq!(host.active.len(), limit);
        // A replay neither starts a second process nor completes the original with an error.
        assert!(host
            .request_with_grant("0".into(), fixture.request("0"), (limit, fixture.grant()))
            .is_none());
        host.cancel("0");
        let replies = wait_reply(&mut host);
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["commandId"], "0");
        assert!(replies[0]["error"].is_string());
        for index in (1..limit).rev() {
            fixture.release(&index.to_string());
            let replies = wait_reply(&mut host);
            assert_eq!(replies.len(), 1);
            assert_eq!(replies[0]["commandId"], index.to_string());
            assert!(replies[0]["error"].is_null(), "command failed: {replies:?}");
            assert_eq!(
                replies[0]["data"]["stdout"].as_str().unwrap().trim(),
                index.to_string()
            );
        }
        wait_until(|| EXECUTING.load(Ordering::Acquire) == 0);
        assert!(host.active.is_empty());
        assert!(host
            .request_with_grant("0".into(), fixture.request("0"), (limit, fixture.grant()))
            .is_none());
        assert!(host.active.is_empty());
        test_buffered_results(&fixture, limit);
        test_disconnect_and_revocation(&fixture);
    }
}

fn test_buffered_results(fixture: &Fixture, limit: usize) {
    let mut host = CommandHost::new();
    for index in 0..limit {
        let id = format!("buffer-{index}");
        assert!(host
            .request_with_grant(id.clone(), fixture.request(&id), (limit, fixture.grant()))
            .is_none());
        fixture.release(&id);
    }
    // Deliberately do not poll the host while every worker finishes; the old shared
    // four-slot result queue would discard responses in this situation.
    wait_until(|| EXECUTING.load(Ordering::Acquire) == 0);
    let replies = host.responses();
    assert_eq!(replies.len(), limit);
    let ids: std::collections::HashSet<_> = replies
        .iter()
        .map(|reply| {
            let id = reply["commandId"].as_str().unwrap();
            assert_eq!(reply["data"]["stdout"].as_str().unwrap().trim(), id);
            id
        })
        .collect();
    assert_eq!(ids.len(), limit);
}

fn test_disconnect_and_revocation(fixture: &Fixture) {
    let mut host = CommandHost::new();
    for id in ["drop-a", "drop-b"] {
        assert!(host
            .request_with_grant(id.into(), fixture.request(id), (5, fixture.grant()))
            .is_none());
    }
    let flags: Vec<_> = host
        .active
        .values()
        .map(|task| task.cancelled.clone())
        .collect();
    drop(host);
    assert!(flags.iter().all(|flag| flag.load(Ordering::Acquire)));
    wait_until(|| EXECUTING.load(Ordering::Acquire) == 0);
    let mut host = CommandHost::new();
    for id in ["revoke-a", "revoke-b"] {
        assert!(host
            .request_with_grant(id.into(), fixture.request(id), (5, fixture.grant()))
            .is_none());
    }
    wait_until(|| {
        ["revoke-a", "revoke-b"]
            .iter()
            .all(|id| fixture.root.join(format!("ready-{id}")).exists())
    });
    let mut record = state::read(&fixture.root, &fixture.id).unwrap().unwrap();
    record.enabled = false;
    state::save(&fixture.root, &record).unwrap();
    wait_until(|| EXECUTING.load(Ordering::Acquire) == 0);
    let replies = host.responses();
    assert_eq!(replies.len(), 2);
    assert!(replies.iter().all(|reply| reply["error"].is_string()));
    for limit in [0, 33] {
        assert!(host
            .request_with_grant(
                "invalid".into(),
                fixture.request("invalid"),
                (limit, fixture.grant())
            )
            .unwrap()["error"]
            .is_string());
    }
}
