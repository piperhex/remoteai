use super::*;
use serde_json::json;

fn entry(id: &str, cwd: &str) -> ThreadEntry {
    ThreadEntry {
        session_id: id.into(),
        session_kind: "conversation".into(),
        title: "Conversation".into(),
        cwd: cwd.into(),
        updated_at: None,
        size_bytes: 10,
        match_excerpt: None,
        account_id: None,
        account_email: None,
        account_active: false,
    }
}

#[test]
fn uses_source_project_names_and_membership_without_rewriting_original_directories() {
    let projects = SourceProjects::from_value(&json!({
        "local-projects": {
            "main": { "name": "Customer portal", "rootPaths": ["D:/work/portal", "D:/work/backend"] },
            "nested": { "name": "Nested project", "rootPaths": ["D:/work/portal/nested"] }
        },
        "thread-project-assignments": { "assigned": { "projectKind": "local", "projectId": "main" } }
    }));
    for cwd in [r"\\?\D:\work\portal\src", "d:/WORK/backend"] {
        let result = projects.describe(entry("inferred", cwd));
        assert_eq!(result.project_name.as_deref(), Some("Customer portal"));
        assert_eq!(result.project_path.as_deref(), Some("D:/work/portal"));
        assert_eq!(result.entry.cwd, cwd);
    }
    let moved = projects.describe(entry("assigned", "/old-project"));
    assert_eq!(moved.project_name.as_deref(), Some("Customer portal"));
    let nested = projects.describe(entry("nested", "D:/work/portal/nested/src"));
    assert_eq!(nested.project_name.as_deref(), Some("Nested project"));
    let unrelated = projects.describe(entry("unrelated", "D:/work/portal-other"));
    assert!(unrelated.project_path.is_none());
}

#[test]
fn explicit_projectless_metadata_wins_over_temporary_or_stale_project_paths() {
    let projects = SourceProjects::from_value(&json!({
        "projectless-thread-ids": ["recent"],
        "thread-projectless-output-directories": { "output": "D:/redirected/Codex/chat/outputs" },
        "local-projects": { "old": { "name": "Old project", "rootPaths": ["/old"] } },
        "thread-project-assignments": { "recent": { "projectKind": "local", "projectId": "old" } }
    }));
    for (id, cwd) in [("recent", "/old"), ("output", "D:/redirected/Codex/chat")] {
        let result = projects.describe(entry(id, cwd));
        assert_eq!(result.project_path.as_deref(), Some(""));
        assert!(result.project_name.is_none());
        assert_eq!(result.entry.cwd, cwd);
    }
}

#[test]
fn preserves_legacy_labels_and_cross_platform_path_semantics() {
    let projects = SourceProjects::from_value(&json!({
        "electron-workspace-root-labels": {
            "//server/share/Project": "Shared project", "/Work/Project": "Unix project"
        }
    }));
    let unc = projects.describe(entry("unc", r"\\?\UNC\SERVER\share\project\src"));
    assert_eq!(unc.project_name.as_deref(), Some("Shared project"));
    assert_eq!(
        projects
            .describe(entry("unix", "/Work/Project/src"))
            .project_name
            .as_deref(),
        Some("Unix project")
    );
    assert!(projects
        .describe(entry("different", "/work/project"))
        .project_name
        .is_none());
}

#[test]
fn reads_only_the_selected_home_and_tolerates_missing_optional_preferences() {
    let home = tempfile::tempdir().unwrap();
    assert!(SourceProjects::read(home.path())
        .unwrap()
        .projects
        .is_empty());
    std::fs::write(
        home.path().join(GLOBAL_STATE),
        r#"{"projectless-thread-ids":["recent"]}"#,
    )
    .unwrap();
    assert_eq!(
        SourceProjects::read(home.path())
            .unwrap()
            .describe(entry("recent", "/scratch"))
            .project_path
            .as_deref(),
        Some("")
    );
    std::fs::write(home.path().join(GLOBAL_STATE), "{").unwrap();
    assert!(matches!(
        SourceProjects::read(home.path()),
        Err(MetadataError::Json(_))
    ));
}
