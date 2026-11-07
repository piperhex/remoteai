use super::*;

fn browse(directory: &str) -> Result<DirectoryListing> {
    browse_entries(directory, false)
}

#[test]
fn desktop_listing_includes_file_metadata_without_changing_folder_only_clients() {
    let root = std::env::temp_dir().join(format!("csw-picker-details-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("readme.txt"), "hello").unwrap();
    let listing = browse_entries(&execution_path(&root), true).unwrap();
    assert_eq!(listing.entries.len(), 2);
    assert!(listing.entries[0].directory);
    assert_eq!(listing.entries[0].size, None);
    assert!(!listing.entries[1].directory);
    assert_eq!(listing.entries[1].size, Some(5));
    assert!(listing.entries[1].modified.is_some());
    assert_eq!(browse(&execution_path(&root)).unwrap().entries.len(), 1);
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lists_only_folders_and_can_navigate_to_the_parent() {
    let root = std::env::temp_dir().join(format!("csw-project-picker-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    fs::create_dir(root.join("zeta")).unwrap();
    fs::create_dir(root.join("Alpha")).unwrap();
    fs::write(root.join("private.txt"), "not a folder").unwrap();
    let listing = browse(&execution_path(&root)).unwrap();
    assert_eq!(listing.entries.len(), 2);
    assert_eq!(listing.entries[0].name, "Alpha");
    assert_eq!(listing.entries[1].name, "zeta");
    assert!(!listing.truncated);
    let child = browse(&listing.entries[0].path).unwrap();
    assert_eq!(child.parent, Some(execution_path(&root)));
    assert!(child.entries.is_empty());
    assert!(browse(&execution_path(&root.join("private.txt"))).is_err());
    assert!(browse(&execution_path(&root.join("missing"))).is_err());
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_relative_overlong_and_control_character_paths() {
    for path in [
        "relative",
        "../parent",
        "C:\\invalid\0folder",
        "/invalid\nfolder",
    ] {
        assert!(browse(path).is_err());
    }
    assert!(browse(&"/".repeat(MAX_PATH_BYTES + 1)).is_err());
}

#[test]
fn computer_root_is_navigation_only() {
    let listing = browse("").unwrap();
    assert!(listing.directory.is_empty());
    assert_eq!(listing.parent, None);
    assert!(!listing.entries.is_empty());
    for root in listing.entries {
        assert!(Path::new(&root.path).is_absolute());
        assert!(root.directory);
        assert!(root.modified.is_none());
        assert!(root.size.is_none());
    }
}

#[tokio::test]
async fn directory_requests_do_not_wait_for_chat_connection_or_replacement() {
    use super::super::{execute_request, protocol::GuiRequest, GuiState};
    let state = GuiState::default();
    let _connecting = state.client.lock().await;
    let _replacing = state.activity.write().await;
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("project")).unwrap();
    let response = timeout(
        Duration::from_secs(2),
        execute_request(
            &state,
            GuiRequest::ProjectDirectories {
                directory: execution_path(root.path()),
                include_files: true,
            },
        ),
    )
    .await
    .expect("filesystem browsing must not wait for chat locks")
    .unwrap();
    assert_eq!(response.data["entries"][0]["name"], "project");
}

#[tokio::test]
async fn computer_roots_are_available_without_a_chat_client() {
    use super::super::{execute_request, protocol::GuiRequest, GuiState};
    let response = execute_request(
        &GuiState::default(),
        GuiRequest::ProjectDirectories {
            directory: String::new(),
            include_files: true,
        },
    )
    .await
    .unwrap();
    assert!(!response.data["entries"].as_array().unwrap().is_empty());
    assert!(response.data["shortcuts"]["home"].is_string());
}

#[test]
fn root_shortcuts_use_host_known_folders_without_changing_drive_entries() {
    let listing = browse("").unwrap();
    let shortcuts = listing.shortcuts.as_ref().unwrap();
    assert_eq!(
        shortcuts.home,
        dirs::home_dir().as_deref().map(execution_path)
    );
    assert_eq!(
        shortcuts.desktop,
        dirs::desktop_dir().as_deref().map(execution_path)
    );
    assert_eq!(
        shortcuts.downloads,
        dirs::download_dir().as_deref().map(execution_path)
    );
    assert_eq!(
        shortcuts.documents,
        dirs::document_dir().as_deref().map(execution_path)
    );
    let paths: Vec<_> = listing
        .entries
        .iter()
        .map(|entry| entry.path.clone())
        .collect();
    assert_eq!(
        paths,
        directory_roots()
            .iter()
            .map(|path| execution_path(path))
            .collect::<Vec<_>>()
    );
    let home = shortcuts.home.as_ref().unwrap();
    let child = serde_json::to_value(browse(home).unwrap()).unwrap();
    assert!(child.get("shortcuts").is_none());
    let root = serde_json::to_value(listing).unwrap();
    assert!(root["shortcuts"].get("home").is_some());
}

#[test]
fn bounds_large_folder_listings() {
    let root = std::env::temp_dir().join(format!("csw-project-picker-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    for index in 0..=MAX_ENTRIES {
        fs::create_dir(root.join(index.to_string())).unwrap();
    }
    let listing = browse(&execution_path(&root)).unwrap();
    assert_eq!(listing.entries.len(), MAX_ENTRIES);
    assert!(listing.truncated);
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
}
