use super::*;
use std::sync::mpsc;

#[test]
fn different_files_can_run_while_same_file_waits() {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("first");
    let second = root.path().join("second");
    let guard = acquire(&first, false).unwrap();
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let _guard = acquire(&first, false).unwrap();
        sender.send(()).unwrap();
    });
    assert!(receiver.recv_timeout(Duration::from_millis(60)).is_err());
    let other = acquire(&second, false).unwrap();
    drop(other);
    drop(guard);
    receiver.recv_timeout(Duration::from_secs(2)).unwrap();
    worker.join().unwrap();
}

#[test]
fn subtree_mutation_and_cancelled_wait_respect_file_claims() {
    let root = tempfile::tempdir().unwrap();
    let _guard = acquire(root.path(), true).unwrap();
    let flag = AtomicBool::new(true);
    assert!(matches!(
        acquire_cancellable(&root.path().join("child"), false, Some(&flag)),
        Err(GuiError::FileExpired)
    ));
}

#[test]
fn symbolic_aliases_share_one_identity_or_are_refused_by_the_os() {
    // Windows can prohibit traversing user-created junctions in the protected system temp directory.
    let root = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
    let directory = root.path().join("real");
    let link = root.path().join("alias");
    fs::create_dir(&directory).unwrap();
    let path = directory.join("file.txt");
    let alias = link.join("file.txt");
    fs::write(&path, "source").unwrap();
    #[cfg(windows)]
    {
        // Directory junctions exercise Windows reparse-point aliases without SeCreateSymbolicLinkPrivilege.
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&directory)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&directory, &link).unwrap();
    let canonical_alias = match alias.canonicalize() {
        Ok(path) => path,
        #[cfg(windows)]
        Err(error) if error.raw_os_error() == Some(448) => {
            // Some Windows security tokens prohibit all untrusted mount points. The service must refuse it too.
            let target: Target = serde_json::from_value(serde_json::json!({
                "cwd": execution_path(root.path()), "path": "alias/file.txt"
            }))
            .unwrap();
            assert!(super::resolve(&target).is_err());
            eprintln!("Windows denied junction traversal (448); positive symlink coverage requires Unix or a permitted host.");
            return;
        }
        Err(error) => panic!("canonical alias: {error}"),
    };
    assert_eq!(
        identity(&path.canonicalize().unwrap()),
        identity(&canonical_alias)
    );
    let _guard = acquire(&path.canonicalize().unwrap(), false).unwrap();
    assert!(matches!(
        acquire_cancellable(&canonical_alias, false, Some(&AtomicBool::new(true))),
        Err(GuiError::FileExpired)
    ));
}
