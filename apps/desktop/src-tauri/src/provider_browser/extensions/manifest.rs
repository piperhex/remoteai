use super::{Error, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_ICON_BYTES: u64 = 128 * 1024;
pub(super) const MAX_EXTENSION_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const MAX_EXTENSION_FILES: usize = 20_000;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Manifest {
    pub name: String,
    pub version: String,
    pub icon: Option<String>,
    pub popup: Option<String>,
    pub permissions: Vec<String>,
}

pub(super) fn child(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::Invalid);
    }
    let root = root.canonicalize().map_err(|_| Error::Invalid)?;
    let target = root.join(path).canonicalize().map_err(|_| Error::Invalid)?;
    if !target.starts_with(&root) {
        return Err(Error::Invalid);
    }
    Ok(target)
}

fn json(path: &Path) -> Result<Value> {
    if fs::metadata(path).map_err(|_| Error::Invalid)?.len() > MAX_MANIFEST_BYTES {
        return Err(Error::Invalid);
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| Error::Invalid)?).map_err(|_| Error::Invalid)
}

fn localized(root: &Path, value: &Value, name: &str) -> String {
    let Some(key) = name
        .strip_prefix("__MSG_")
        .and_then(|name| name.strip_suffix("__"))
    else {
        return name.to_owned();
    };
    let locale = value["default_locale"].as_str().unwrap_or("en");
    child(root, &format!("_locales/{locale}/messages.json"))
        .and_then(|path| json(&path))
        .ok()
        .and_then(|messages| messages[key]["message"].as_str().map(str::to_owned))
        .unwrap_or_else(|| name.to_owned())
}

pub(super) fn read(root: &Path) -> Result<Manifest> {
    let value = json(&child(root, "manifest.json")?)?;
    if !matches!(value["manifest_version"].as_u64(), Some(2 | 3)) {
        return Err(Error::Invalid);
    }
    let name = value["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .ok_or(Error::Invalid)?;
    let version = value["version"].as_str().ok_or(Error::Invalid)?.to_owned();
    let action = value.get("action").or_else(|| value.get("browser_action"));
    let popup = action
        .and_then(|action| action["default_popup"].as_str())
        .filter(|path| !path.is_empty() && child(root, path).is_ok())
        .map(str::to_owned);
    let icon = action
        .and_then(|action| read_icon(root, &action["default_icon"]))
        .or_else(|| read_icon(root, &value["icons"]));
    let permissions = ["permissions", "host_permissions"]
        .iter()
        .filter_map(|key| value[key].as_array())
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    Ok(Manifest {
        name: localized(root, &value, name),
        version,
        icon,
        popup,
        permissions,
    })
}

fn read_icon(root: &Path, definition: &Value) -> Option<String> {
    if let Some(path) = definition.as_str() {
        return icon(root, path).ok();
    }
    let icons = definition.as_object()?;
    let preferred = ["48", "32", "128", "24", "19", "16"]
        .into_iter()
        .filter_map(|size| icons.get(size)?.as_str());
    preferred
        .chain(icons.values().filter_map(Value::as_str))
        .find_map(|path| icon(root, path).ok())
}

fn icon(root: &Path, relative: &str) -> Result<String> {
    let path = child(root, relative.trim_start_matches('/'))?;
    if fs::metadata(&path).map_err(|_| Error::Invalid)?.len() > MAX_ICON_BYTES {
        return Err(Error::Invalid);
    }
    let bytes = fs::read(path).map_err(|_| Error::Invalid)?;
    // Return raster data only: never embed an extension's SVG or HTML in the privileged host UI.
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        "image/x-icon"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        return Err(Error::Invalid);
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Immutable private copies survive Chrome upgrades and edits to the original unpacked directory.
pub(super) fn copy(source: &Path, destination: &Path) -> Result<()> {
    let source = source.canonicalize().map_err(|_| Error::Invalid)?;
    if destination.starts_with(&source) {
        return Err(Error::Invalid);
    }
    read(&source)?;
    let mut queue = vec![(source, destination.to_path_buf())];
    let (mut bytes, mut files) = (0_u64, 0_usize);
    while let Some((from, to)) = queue.pop() {
        fs::create_dir_all(&to).map_err(|_| Error::Storage)?;
        for entry in fs::read_dir(&from).map_err(|_| Error::Invalid)? {
            let entry = entry.map_err(|_| Error::Invalid)?;
            // Chrome store metadata is reserved and rejected by AddBrowserExtension.
            if entry.file_name() == "_metadata" {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(|_| Error::Invalid)?;
            if metadata.file_type().is_symlink() || reparse(&metadata) {
                return Err(Error::Invalid);
            }
            files += 1;
            bytes += metadata.len();
            if files > MAX_EXTENSION_FILES || bytes > MAX_EXTENSION_BYTES {
                return Err(Error::Invalid);
            }
            let target = to.join(entry.file_name());
            if metadata.is_dir() {
                queue.push((entry.path(), target));
            } else if metadata.is_file() {
                fs::copy(entry.path(), target).map_err(|_| Error::Storage)?;
            } else {
                return Err(Error::Invalid);
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn reparse(_: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_action_icons_and_falls_back_across_missing_sizes() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("toolbar.png"),
            include_bytes!("../../../resources/chrome-extension/icon.png"),
        )
        .unwrap();
        fs::write(
            root.path().join("manifest.json"),
            r#"{
            "manifest_version":3,"name":"test","version":"1","icons":{"48":"missing.png"},
            "action":{"default_icon":{"20":"toolbar.png"}}
        }"#,
        )
        .unwrap();
        assert!(read(root.path())
            .unwrap()
            .icon
            .unwrap()
            .starts_with("data:image/png;base64,"));
        fs::write(root.path().join("manifest.json"), r#"{
            "manifest_version":3,"name":"test","version":"1","icons":{"48":"missing.png","128":"toolbar.png"}
        }"#).unwrap();
        assert!(read(root.path()).unwrap().icon.is_some());
        fs::write(root.path().join("unsafe.svg"), "<svg></svg>").unwrap();
        assert!(icon(root.path(), "unsafe.svg").is_err());
    }
    #[test]
    fn rejects_traversal_and_non_extensions() {
        let root = tempfile::tempdir().unwrap();
        assert!(child(root.path(), "../manifest.json").is_err());
        assert!(child(root.path(), "C:/manifest.json").is_err());
        fs::write(
            root.path().join("manifest.json"),
            r#"{"name":"test","version":"1","manifest_version":1}"#,
        )
        .unwrap();
        assert!(read(root.path()).is_err());
    }
    #[test]
    fn copies_content_but_not_chrome_metadata() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir_all(source.join("_metadata")).unwrap();
        fs::write(
            source.join("manifest.json"),
            r#"{"name":"test","version":"1","manifest_version":3}"#,
        )
        .unwrap();
        fs::write(
            source.join("content.js"),
            "document.body.dataset.extension = 'true'",
        )
        .unwrap();
        let destination = root.path().join("copy");
        copy(&source, &destination).unwrap();
        assert!(destination.join("content.js").exists());
        assert!(!destination.join("_metadata").exists());
        assert_eq!(read(&destination).unwrap().name, "test");
    }
}
