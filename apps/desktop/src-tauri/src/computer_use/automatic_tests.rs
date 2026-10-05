use super::*;
use std::{cell::Cell, path::PathBuf};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("computer-use-setup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn home(&self) -> PathBuf {
        self.0.join("gui-home")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn first_connection_installs_once_per_home() {
    let fixture = Fixture::new();
    let calls = Cell::new(0);
    let starts = Cell::new(0);
    let starting = || starts.set(starts.get() + 1);
    let install = || {
        calls.set(calls.get() + 1);
        assert_eq!(starts.get(), calls.get());
        Ok(())
    };
    setup_with(&fixture.0, &fixture.home(), starting, install).unwrap();
    setup_with(&fixture.0, &fixture.home(), starting, install).unwrap();
    assert_eq!(calls.get(), 1);
    assert_eq!(starts.get(), 1);
    setup_with(
        &fixture.0,
        &fixture.0.join("another-home"),
        starting,
        install,
    )
    .unwrap();
    assert_eq!(calls.get(), 2);
    assert_eq!(starts.get(), 2);
}

#[test]
fn existing_enabled_and_disabled_installations_are_preserved() {
    for enabled in [true, false] {
        let fixture = Fixture::new();
        let home = fixture.home();
        state::save(
            &fixture.0,
            &state::Record {
                home: home.clone(),
                enabled,
                generation: "existing".into(),
            },
        )
        .unwrap();
        setup_with(
            &fixture.0,
            &home,
            || panic!("must not start related setup"),
            || panic!("must preserve installation"),
        )
        .unwrap();
        let record = state::read(&fixture.0, &state::home_id(&home))
            .unwrap()
            .unwrap();
        assert_eq!(record.enabled, enabled);
        assert_eq!(record.generation, "existing");
    }
}

#[test]
fn manual_removal_before_first_gui_connection_prevents_auto_install() {
    let fixture = Fixture::new();
    remember(&fixture.0, &fixture.home()).unwrap();
    assert!(state::read(&fixture.0, &state::home_id(&fixture.home()))
        .unwrap()
        .is_none());
    setup_with(
        &fixture.0,
        &fixture.home(),
        || panic!("must not start related setup"),
        || panic!("must preserve removal"),
    )
    .unwrap();
}

#[test]
fn related_setup_starts_even_if_download_fails_and_neither_retries_on_reconnect() {
    let fixture = Fixture::new();
    let started = Cell::new(false);
    assert!(matches!(
        setup_with(
            &fixture.0,
            &fixture.home(),
            || started.set(true),
            || {
                assert!(started.get());
                Err(ComputerError::Download)
            },
        ),
        Err(ComputerError::Download)
    ));
    setup_with(
        &fixture.0,
        &fixture.home(),
        || panic!("must not restart related setup"),
        || panic!("manual repair required"),
    )
    .unwrap();
}

#[test]
fn unreadable_record_does_not_overwrite_existing_setup() {
    let fixture = Fixture::new();
    let home = fixture.home();
    let path = state::path(&fixture.0, &state::home_id(&home)).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "invalid").unwrap();
    assert!(setup_with(
        &fixture.0,
        &home,
        || panic!("must not start related setup"),
        || panic!("must preserve record"),
    )
    .is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "invalid");
}
