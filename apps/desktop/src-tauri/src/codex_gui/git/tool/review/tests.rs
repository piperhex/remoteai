use super::super::tests::Repo;
use super::*;

#[test]
fn revisions_cover_index_worktree_untracked_and_branch_changes() {
    let repo = Repo::new(true);
    let base = revision::read(&repo.0).unwrap();
    repo.write("one.txt", "changed\n");
    let edited = revision::read(&repo.0).unwrap();
    assert_ne!(base.id, edited.id);
    repo.git(&["add", "one.txt"]);
    let staged = revision::read(&repo.0).unwrap();
    assert_ne!(staged.id, edited.id);
    repo.write("untracked.txt", "same length A");
    let first = revision::read(&repo.0).unwrap();
    repo.write("untracked.txt", "same length B");
    assert_ne!(first.id, revision::read(&repo.0).unwrap().id);
    let previous = revision::read(&repo.0).unwrap();
    repo.git(&["switch", "-c", "feature"]);
    assert_ne!(previous.id, revision::read(&repo.0).unwrap().id);
}

#[test]
fn a_real_check_records_exit_status_and_expires_when_it_changes_source() {
    let repo = Repo::new(true);
    repo.write("package.json", r#"{"scripts":{"test":"node -e \"require('fs').writeFileSync('one.txt','new code');process.exit(7)\""}}"#);
    let storage = repo.0.join(".git/review-test");
    std::fs::create_dir(&storage).unwrap();
    let version = revision::read(&repo.0).unwrap();
    let result = checks::start(
        &repo.0,
        &repo.0,
        &storage,
        checks::Start {
            kind: checks::Kind::Test,
            expected: &version.id,
        },
    )
    .unwrap();
    assert!(result.status == store::Status::Running);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let check = store::read(&storage).unwrap().pop().unwrap();
        if check.status != store::Status::Running {
            assert!(check.status == store::Status::Failed, "{}", check.output);
            assert_eq!(check.exit_code, Some(7), "{}", check.output);
            assert_ne!(
                check.finished_revision.as_deref(),
                Some(check.revision.as_str())
            );
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "project check did not finish"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[test]
fn only_existing_fixed_project_checks_can_be_started() {
    let repo = Repo::new(true);
    repo.write(
        "package.json",
        r#"{"scripts":{"test":"echo done","build":"echo ok","deploy":"echo no"}}"#,
    );
    let plans = checks::discover(&repo.0).unwrap();
    let value = serde_json::to_value(plans).unwrap();
    assert_eq!(value.as_array().unwrap().len(), 2);
    assert_eq!(value[0]["command"], "npm run build");
    let storage = repo.0.join(".git/review-test");
    std::fs::create_dir(&storage).unwrap();
    assert!(matches!(
        checks::start(
            &repo.0,
            &repo.0,
            &storage,
            checks::Start {
                kind: checks::Kind::Test,
                expected: "old"
            }
        ),
        Err(GitError::ReviewChanged)
    ));
}

#[test]
fn hidden_worktree_changes_cannot_be_certified() {
    for flag in ["--assume-unchanged", "--skip-worktree"] {
        let repo = Repo::new(true);
        repo.git(&["update-index", flag, "one.txt"]);
        repo.write("one.txt", "invisible edit\n");
        assert!(matches!(
            revision::read(&repo.0),
            Err(GitError::ReviewHiddenFiles)
        ));
    }
}

#[test]
fn a_restart_never_turns_an_unfinished_check_into_a_pass() {
    let repo = Repo::new(true);
    let storage = repo.0.join(".git/review-test");
    std::fs::create_dir(&storage).unwrap();
    let receipt = serde_json::json!({ "session":"previous-process", "check":{
        "kind":"test", "command":"npm run test", "status":"running", "revision":"version",
        "finishedRevision":null, "startedAt":1, "finishedAt":null, "exitCode":null, "output":"" }});
    std::fs::write(storage.join("test.json"), receipt.to_string()).unwrap();
    assert!(store::read(&storage).unwrap()[0].status == store::Status::Interrupted);
}
#[test]
fn revision_includes_more_than_two_thousand_untracked_files() {
    let repo = super::super::tests::Repo::new(true);
    for index in 0..2_100 {
        repo.write(&format!("file-{index:04}.txt"), "untracked\n");
    }
    let before = super::revision::read(&repo.0).unwrap();
    assert!(before.dirty);
    repo.write("file-2099.txt", "changed\n");
    assert_ne!(before.id, super::revision::read(&repo.0).unwrap().id);
}
