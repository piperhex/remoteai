use super::*;
use std::path::PathBuf;

#[test]
fn corrupt_installation_records_and_failed_publication_are_distinct() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("installed.json"), b"invalid json").unwrap();
    assert!(matches!(
        installed(&fixture.0),
        Err(GuiError::InstallStateRead)
    ));
    let record = fixture.0.join("record-directory");
    fs::create_dir(&record).unwrap();
    assert!(matches!(
        write_record(&record, &Installed { version: None }),
        Err(GuiError::InstallStateWrite | GuiError::InstallPermission)
    ));
}

#[test]
fn cached_status_exposes_updates_through_download_and_clears_them_after_activation() {
    let fixture = Fixture::new();
    fixture.remember("0.99.0");
    fixture.package("0.99.0");
    activate(&fixture.0).unwrap();
    assert!(status(&fixture.0).unwrap().release.is_none());
    fixture.remember("0.100.0");
    let downloading = status(&fixture.0).unwrap();
    assert_eq!(downloading.version.as_deref(), Some("0.99.0"));
    assert!(!downloading.release.unwrap().ready);
    fixture.package("0.100.0");
    assert!(status(&fixture.0).unwrap().release.unwrap().ready);
    activate(&fixture.0).unwrap();
    let installed = status(&fixture.0).unwrap();
    assert_eq!(installed.version.as_deref(), Some("0.100.0"));
    assert!(installed.release.is_none());
}

pub(in crate::codex_gui::releases) struct Fixture(pub PathBuf);
impl Fixture {
    pub(in crate::codex_gui::releases) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("cli-update-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }

    pub(in crate::codex_gui::releases) fn package(&self, version: &str) {
        let path = self.0.join(version).join(entrypoint());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"verified test package").unwrap();
    }

    pub(in crate::codex_gui::releases) fn remember(&self, version: &str) -> ReleaseInfo {
        remember(
            &self.0,
            ReleaseInfo {
                version: version.into(),
                size: 100,
                ready: false,
            },
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn prepared_package_is_only_activated_explicitly_or_on_startup() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    fixture.package("0.100.0");
    assert!(installed(&fixture.0).unwrap().version.is_none());
    assert_eq!(
        activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.100.0")
    );
    assert_eq!(
        installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.100.0")
    );
}

#[test]
fn newer_incomplete_download_blocks_an_older_ready_update_even_after_restart() {
    let fixture = Fixture::new();
    fixture.remember("0.99.0");
    fixture.package("0.99.0");
    activate(&fixture.0).unwrap();
    fixture.remember("0.100.0");
    fixture.package("0.100.0");
    fixture.remember("0.101.0");
    assert_eq!(
        activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.99.0")
    );
    assert_eq!(pending(&fixture.0).unwrap().unwrap().version, "0.101.0");
    fixture.package("0.101.0");
    assert_eq!(
        activate(&fixture.0).unwrap().version.as_deref(),
        Some("0.101.0")
    );
}

#[test]
fn out_of_order_checks_and_semver_comparison_never_downgrade() {
    let fixture = Fixture::new();
    fixture.remember("0.100.0");
    assert_eq!(fixture.remember("0.99.0").version, "0.100.0");
    fixture.package("0.100.0");
    activate(&fixture.0).unwrap();
    assert_eq!(fixture.remember("0.99.0").version, "0.100.0");
    assert!(!newer("0.100.0-alpha.1", "0.100.0"));
    assert!(!newer("0.100.0+build.2", "0.100.0+build.1"));
}

#[test]
fn untrusted_pending_paths_and_ready_flags_are_rejected() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("pending.json"),
        r#"{"version":"../outside","size":100,"ready":true}"#,
    )
    .unwrap();
    assert!(pending(&fixture.0).is_err());
    assert!(activate(&fixture.0).is_err());
    fs::write(
        fixture.0.join("pending.json"),
        r#"{"version":"0.100.0","size":100,"ready":true}"#,
    )
    .unwrap();
    assert!(!pending(&fixture.0).unwrap().unwrap().ready);
    assert!(activate(&fixture.0).unwrap().version.is_none());
}
