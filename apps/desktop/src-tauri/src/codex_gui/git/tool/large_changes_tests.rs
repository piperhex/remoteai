use super::super::output;
use super::{changes, commit, commit_files, file_actions, tests::Repo, SelectedFile};
use std::{fs, io::Write, process::Stdio};

const FILE_COUNT: usize = 3_000;

#[test]
fn large_workspaces_commit_and_restore_every_selected_path() {
    let repo = Repo::new(true);
    fs::create_dir(repo.0.join("generated")).unwrap();
    repo.write("two.txt", "keep staged\n");
    repo.git(&["add", "two.txt"]);
    for index in 0..FILE_COUNT {
        repo.write(&format!("generated/long-file-name-{index:05}.txt"), "new\n");
    }
    let current = changes::read(&repo.0).unwrap();
    assert_eq!(current.files.len(), FILE_COUNT + 1);
    let selected: Vec<_> = current
        .files
        .iter()
        .filter(|file| file.path.starts_with("generated/"))
        .map(|file| SelectedFile {
            path: file.path.clone(),
            version: file.version.clone(),
        })
        .collect();
    assert!(
        selected
            .iter()
            .map(|file| file.path.len() + 1)
            .sum::<usize>()
            > 32_767
    );
    let hash = commit::create(
        &repo.0,
        current.head.as_deref(),
        "all generated files",
        &selected,
    )
    .unwrap();
    assert_eq!(
        commit_files::read(&repo.0, &hash).unwrap().len(),
        FILE_COUNT
    );
    assert_eq!(
        output(&repo.0, &["show", ":two.txt"]).unwrap(),
        "keep staged"
    );
    assert_eq!(output(&repo.0, &["show", "HEAD:two.txt"]).unwrap(), "two");
    for file in selected {
        repo.write(&file.path, "edited\n");
    }
    let current = changes::read(&repo.0).unwrap();
    let selected: Vec<_> = current
        .files
        .iter()
        .filter(|file| file.path.starts_with("generated/"))
        .map(|file| SelectedFile {
            path: file.path.clone(),
            version: file.version.clone(),
        })
        .collect();
    file_actions::execute(
        &repo.0,
        Some(&hash),
        file_actions::Action::Rollback,
        &selected,
    )
    .unwrap();
    let remaining = changes::read(&repo.0).unwrap();
    assert_eq!(remaining.files.len(), 1);
    assert_eq!(remaining.files[0].path, "two.txt");
    assert_eq!(
        fs::read_to_string(repo.0.join("generated/long-file-name-02999.txt")).unwrap(),
        "new\n"
    );
}

#[test]
fn complete_commit_file_lists_can_exceed_one_megabyte() {
    let repo = Repo::new(true);
    let blob = output(&repo.0, &["rev-parse", "HEAD:one.txt"]).unwrap();
    let paths: String = (0..6_000)
        .map(|index| {
            format!(
                "100644 {blob}\t{}-{index:05}.txt\0",
                "long-path-".repeat(20)
            )
        })
        .collect();
    assert!(paths.len() > 1024 * 1024);
    let mut child = super::super::command(&repo.0)
        .args(["update-index", "-z", "--index-info"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(paths.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());
    repo.git(&["commit", "-m", "large index"]);
    let head = changes::head(&repo.0).unwrap();
    assert_eq!(commit_files::read(&repo.0, &head).unwrap().len(), 6_000);
}

#[test]
fn porcelain_status_keeps_all_records_and_rename_sources() {
    let input: String = (0..25_000)
        .map(|index| format!(" M src/file-{index:05}.ts\0"))
        .collect();
    let input = format!("{input}R  renamed.ts\0original.ts\0");
    let files = changes::parse(input.as_bytes()).unwrap();
    assert_eq!(files.len(), 25_001);
    assert_eq!(
        files.last().unwrap().original_path.as_deref(),
        Some("original.ts")
    );
}
