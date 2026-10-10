const RENDERER_RECOVERY_GRACE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum NativeRuntimeStatus {
    Ready,
    Starting,
    Active,
    Paused,
    Failed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeLaunchReason {
    Explicit,
    Recovery,
}

impl NativeSessionState {
    fn begin_launch(&mut self, executable: &Path, reason: RuntimeLaunchReason) {
        self.session = NativeRuntimeStatus::Starting;
        self.port = None;
        self.codex_executable = Some(executable.display().to_string());
        self.launch_id = Uuid::new_v4().to_string();
        self.recovery_attempted = reason == RuntimeLaunchReason::Recovery;
    }

    fn fail_launch(&mut self) {
        self.recovery_attempted = true;
        // A skin verification error must not discard a working renderer channel.
        if self.session != NativeRuntimeStatus::Active {
            self.session = NativeRuntimeStatus::Failed;
            self.port = None;
        }
    }

    fn allows_recovery(&self) -> bool {
        self.port.is_some()
            && !self.recovery_attempted
            && matches!(
                self.session,
                NativeRuntimeStatus::Active | NativeRuntimeStatus::Paused
            )
    }

    fn allows_recovery_for(&self, executable: &Path) -> bool {
        self.allows_recovery()
            && self
                .codex_executable
                .as_deref()
                .is_some_and(|recorded| path_eq(Path::new(recorded), executable))
    }

    fn same_launch(&self, other: &Self) -> bool {
        self.launch_id == other.launch_id
            && self.port == other.port
            && self.codex_executable == other.codex_executable
    }
}

/// Tracks a continuous outage, without granting new attempts on reconnection or app restart.
#[derive(Default)]
struct RendererRecovery {
    observed: Option<(NativeSessionState, PathBuf, Instant)>,
}

impl RendererRecovery {
    fn reset(&mut self) {
        self.observed = None;
    }

    fn outage_ready(&mut self, state: &NativeSessionState, install: &Path, now: Instant) -> bool {
        // A replacement installed by an updater does not belong to the old CDP
        // session. Waiting longer must never authorize stopping that version.
        if !state.allows_recovery_for(install) {
            self.reset();
            return false;
        }
        match &self.observed {
            Some((previous, previous_install, since))
                if previous.same_launch(state) && path_eq(previous_install, install) =>
            {
                now.saturating_duration_since(*since) >= RENDERER_RECOVERY_GRACE
            }
            _ => {
                self.observed = Some((state.clone(), install.to_path_buf(), now));
                false
            }
        }
    }
}
