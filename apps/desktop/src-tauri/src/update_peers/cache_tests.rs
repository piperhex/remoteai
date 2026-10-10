use super::*;
use crate::update_peers::tests::signed;

fn fixture(version: &str) -> (Artifact, String) {
    let (key, signature) = signed(b"signed installer");
    let mut artifact = Artifact {
        id: String::new(),
        signature,
        version: version.into(),
        target: "windows-x86_64".into(),
        url: "https://github.com/example/installer.exe".into(),
        size: 0,
        saved_at: 0,
    };
    artifact.id = artifact.identity();
    (artifact, key)
}

#[test]
fn signature_and_identity_reject_tampering_and_different_platforms() {
    let (artifact, key) = fixture("1.0.0");
    artifact.verify(b"signed installer", &key).unwrap();
    assert!(artifact.verify(b"tampered installer", &key).is_err());
    assert!(artifact.verify(b"", &key).is_err());
    let mut other = artifact.clone();
    other.target = "darwin-aarch64".into();
    assert_ne!(other.identity(), artifact.id);
    other.target = artifact.target.clone();
    other.version = "2.0.0".into();
    assert_ne!(other.identity(), artifact.id);
}

#[tokio::test]
async fn verified_cache_survives_restart_and_rejects_corruption() {
    let directory = tempfile::tempdir().unwrap();
    let (artifact, key) = fixture("1.0.0");
    let cache = Arc::new(Cache::new(directory.path().into(), key.clone()));
    cache
        .save(artifact.clone(), Arc::new(b"signed installer".to_vec()))
        .await
        .unwrap();
    let restarted = Arc::new(Cache::new(directory.path().into(), key));
    restarted.restore().await.unwrap();
    assert_eq!(
        restarted.read(&artifact.id).await.unwrap(),
        b"signed installer"
    );
    fs::write(
        directory.path().join(format!("{}.pkg", artifact.id)),
        b"broken installer",
    )
    .unwrap();
    assert!(restarted.read(&artifact.id).await.is_err());
    restarted.restore().await.unwrap();
    assert!(restarted.artifacts().is_empty());
    assert!(!directory
        .path()
        .join(format!("{}.pkg", artifact.id))
        .exists());
}

#[tokio::test]
async fn cache_evicts_old_packages_and_never_publishes_invalid_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let (first, key) = fixture("1.0.0");
    let cache = Arc::new(Cache::new(directory.path().into(), key));
    for version in ["1.0.0", "2.0.0", "3.0.0"] {
        cache
            .save(fixture(version).0, Arc::new(b"signed installer".to_vec()))
            .await
            .unwrap();
    }
    assert_eq!(cache.artifacts().len(), MAX_CACHED_PACKAGES);
    assert!(!directory.path().join(format!("{}.pkg", first.id)).exists());
    assert!(cache
        .save(fixture("4.0.0").0, Arc::new(b"untrusted".to_vec()))
        .await
        .is_err());
    assert_eq!(cache.artifacts()[0].version, "3.0.0");
    let mut expired = cache.artifacts();
    expired[0].saved_at = now() - CACHE_LIFETIME.as_secs();
    expired[1].id = "../outside".into();
    fs::write(
        directory.path().join("index.json"),
        serde_json::to_vec(&expired).unwrap(),
    )
    .unwrap();
    cache.restore().await.unwrap();
    assert!(cache.artifacts().is_empty());
}
