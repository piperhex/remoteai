use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const NODE_RESOURCE: &str = "resources/desktop-service/node.exe";

/// Use the packaged Windows runtime for every managed CLI, including account login.
pub(crate) fn executable<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    resolve(
        app.path().resource_dir().ok().as_deref(),
        cfg!(debug_assertions).then(|| Path::new(env!("CARGO_MANIFEST_DIR"))),
    )
}

fn resolve(resources: Option<&Path>, development: Option<&Path>) -> PathBuf {
    if cfg!(windows) {
        for root in resources.into_iter().chain(development) {
            let node = root.join(NODE_RESOURCE);
            if node.is_file() {
                return node;
            }
        }
    }
    // macOS/Linux and development setups without bundled resources retain their existing lookup.
    PathBuf::from("node")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_and_development_resources_share_the_same_node_resolution() {
        let temporary = tempfile::tempdir().unwrap();
        let packaged = temporary.path().join("Remote AI install");
        let development = temporary.path().join("source checkout/src-tauri");
        for root in [&packaged, &development] {
            let node = root.join(NODE_RESOURCE);
            std::fs::create_dir_all(node.parent().unwrap()).unwrap();
            std::fs::write(node, []).unwrap();
        }
        let expected = |root: &Path| {
            if cfg!(windows) {
                root.join(NODE_RESOURCE)
            } else {
                PathBuf::from("node")
            }
        };
        assert_eq!(
            resolve(Some(&packaged), Some(&development)),
            expected(&packaged)
        );
        assert_eq!(resolve(None, Some(&development)), expected(&development));
        std::fs::remove_file(packaged.join(NODE_RESOURCE)).unwrap();
        assert_eq!(
            resolve(Some(&packaged), Some(&development)),
            expected(&development)
        );
        assert_eq!(resolve(Some(&packaged), None), PathBuf::from("node"));
    }
}
