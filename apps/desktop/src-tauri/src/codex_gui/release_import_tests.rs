use super::super::{entrypoint, store::tests::Fixture};
use super::*;

fn package(fixture: &Fixture, version: &str) -> ImportRequest {
    let package_path = fixture.0.join("download.tar.gz");
    let file = fs::File::create(&package_path).unwrap();
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let mut archive = tar::Builder::new(encoder);
    for (name, bytes) in [
        (entrypoint(), b"test codex".as_slice()),
        ("bin/helper", b"test helper"),
    ] {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o755);
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        archive.append_data(&mut header, name, bytes).unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap();
    let bytes = fs::read(&package_path).unwrap();
    let name = asset_name().unwrap();
    let metadata_path = fixture.0.join("release.json");
    fs::write(
        &metadata_path,
        serde_json::to_vec(&serde_json::json!({
            "tag_name": format!("rust-v{version}"),
            "assets": [{ "name": name,
                "browser_download_url": format!("{RELEASE_PAGE}/download/rust-v{version}/{name}"),
                "size": bytes.len(), "digest": format!("sha256:{:x}", Sha256::digest(&bytes)) }]
        }))
        .unwrap(),
    )
    .unwrap();
    ImportRequest {
        package_path,
        metadata_path,
    }
}

#[test]
fn links_work_without_network_or_known_version() {
    let latest = download_links(None).unwrap();
    assert_eq!(
        latest.package_url,
        format!("{RELEASE_PAGE}/latest/download/{}", asset_name().unwrap())
    );
    assert_eq!(latest.metadata_url, format!("{RELEASE_API}/latest"));
    let pinned = download_links(Some("0.161.0")).unwrap();
    assert!(pinned.package_url.contains("/rust-v0.161.0/"));
    assert!(pinned.metadata_url.ends_with("/tags/rust-v0.161.0"));
    assert!(download_links(Some("../escape")).is_err());
}

#[test]
fn offline_import_keeps_helpers_and_activates_first_installation() {
    let fixture = Fixture::new();
    let request = package(&fixture, "0.161.0");
    let (temporary, candidate) = prepare_import(&fixture.0, &request).unwrap();
    assert!(store::installed(&fixture.0).unwrap().version.is_none());
    commit_import(&fixture.0, &temporary.path().join("unpacked"), candidate).unwrap();
    assert_eq!(
        store::installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.161.0")
    );
    assert!(fixture.0.join("0.161.0/bin/helper").is_file());
    assert!(request.package_path.is_file());
    assert!(request.metadata_path.is_file());
}

#[test]
fn an_update_is_staged_without_replacing_an_active_installation() {
    let fixture = Fixture::new();
    fixture.package("0.160.0");
    fixture.remember("0.160.0");
    store::activate(&fixture.0).unwrap();
    let request = package(&fixture, "0.161.0");
    let (temporary, candidate) = prepare_import(&fixture.0, &request).unwrap();
    commit_import(&fixture.0, &temporary.path().join("unpacked"), candidate).unwrap();
    assert_eq!(
        store::installed(&fixture.0).unwrap().version.as_deref(),
        Some("0.160.0")
    );
    assert!(store::pending(&fixture.0).unwrap().unwrap().ready);
    assert!(store::activate_expected(&fixture.0, "0.161.0")
        .unwrap()
        .is_some());
}

#[test]
fn corrupt_or_incomplete_packages_never_change_installed_or_pending_state() {
    let fixture = Fixture::new();
    fixture.package("0.160.0");
    fixture.remember("0.160.0");
    store::activate(&fixture.0).unwrap();
    for truncate in [false, true] {
        let request = package(&fixture, "0.161.0");
        let mut bytes = fs::read(&request.package_path).unwrap();
        if truncate {
            bytes.pop();
        } else {
            bytes[0] ^= 1;
        }
        fs::write(&request.package_path, bytes).unwrap();
        assert!(matches!(
            prepare_import(&fixture.0, &request),
            Err(GuiError::ImportMismatch)
        ));
        assert_eq!(
            store::installed(&fixture.0).unwrap().version.as_deref(),
            Some("0.160.0")
        );
        assert!(!fixture.0.join("0.161.0").exists());
    }
}

#[test]
fn rejects_wrong_platform_missing_digest_and_untrusted_asset_urls() {
    let fixture = Fixture::new();
    for field in ["name", "digest", "browser_download_url", "tag_name"] {
        let request = package(&fixture, "0.161.0");
        let mut metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(&request.metadata_path).unwrap()).unwrap();
        if field == "tag_name" {
            metadata[field] = "rust-v../escape".into();
        } else {
            metadata["assets"][0][field] = "invalid".into();
        }
        fs::write(
            &request.metadata_path,
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
        assert!(prepare_import(&fixture.0, &request).is_err());
    }
}

#[test]
fn stale_import_cannot_overwrite_a_newer_discovery_or_installed_version() {
    let fixture = Fixture::new();
    let request = package(&fixture, "0.161.0");
    let (temporary, candidate) = prepare_import(&fixture.0, &request).unwrap();
    fixture.remember("0.162.0");
    assert!(matches!(
        commit_import(&fixture.0, &temporary.path().join("unpacked"), candidate),
        Err(GuiError::ImportVersion)
    ));
    assert!(!fixture.0.join("0.161.0").exists());
    fixture.package("0.162.0");
    store::activate(&fixture.0).unwrap();
    assert!(matches!(
        check_version(&fixture.0, "0.162.0"),
        Err(GuiError::ImportVersion)
    ));
    assert!(matches!(
        check_version(&fixture.0, "0.161.0"),
        Err(GuiError::ImportVersion)
    ));
}

#[test]
fn import_reuses_a_package_published_by_a_concurrent_download() {
    let fixture = Fixture::new();
    let request = package(&fixture, "0.161.0");
    let (temporary, candidate) = prepare_import(&fixture.0, &request).unwrap();
    fixture.package("0.161.0");
    commit_import(&fixture.0, &temporary.path().join("unpacked"), candidate).unwrap();
    assert_eq!(
        fs::read(fixture.0.join("0.161.0").join(entrypoint())).unwrap(),
        b"verified test package"
    );
}

#[test]
fn paths_and_metadata_are_bounded_local_files() {
    let fixture = Fixture::new();
    assert!(local_file(Path::new("relative.tar.gz"), MAX_DOWNLOAD).is_err());
    assert!(local_file(&fixture.0, MAX_DOWNLOAD).is_err());
    let oversized = fixture.0.join("oversized.json");
    fs::File::create(&oversized)
        .unwrap()
        .set_len(MAX_METADATA + 1)
        .unwrap();
    assert!(read_release(&oversized).is_err());
    fs::write(&oversized, b"not json").unwrap();
    assert!(read_release(&oversized).is_err());
}
