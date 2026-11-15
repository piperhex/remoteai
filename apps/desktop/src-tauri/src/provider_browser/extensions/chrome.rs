use super::{manifest, Error, Result};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Candidate {
    pub path: String,
    pub profile: String,
    #[serde(flatten)]
    pub manifest: manifest::Manifest,
}

#[cfg(windows)]
pub(super) fn discover() -> Result<Vec<Candidate>> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or(Error::Unsupported)?;
    scan(&Path::new(&local).join("Google/Chrome/User Data"))
}

fn scan(root: &Path) -> Result<Vec<Candidate>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for profile in fs::read_dir(root).map_err(|_| Error::Storage)? {
        let profile = profile.map_err(|_| Error::Storage)?;
        let name = profile.file_name().to_string_lossy().into_owned();
        if name != "Default" && !name.starts_with("Profile ") {
            continue;
        }
        let Ok(extensions) = fs::read_dir(profile.path().join("Extensions")) else {
            continue;
        };
        for extension in extensions.flatten() {
            if !extension
                .file_name()
                .to_string_lossy()
                .bytes()
                .all(|byte| (b'a'..=b'p').contains(&byte))
            {
                continue;
            }
            if let Some((path, manifest)) = latest(&extension.path()) {
                result.push(Candidate {
                    path: path.to_string_lossy().into_owned(),
                    profile: name.clone(),
                    manifest,
                });
            }
        }
    }
    result.sort_by(|a, b| {
        a.manifest
            .name
            .cmp(&b.manifest.name)
            .then(a.profile.cmp(&b.profile))
    });
    Ok(result)
}

fn latest(root: &Path) -> Option<(std::path::PathBuf, manifest::Manifest)> {
    fs::read_dir(root)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let manifest = manifest::read(&entry.path()).ok()?;
            Some((entry.path(), manifest))
        })
        .max_by_key(|(_, manifest)| {
            manifest
                .version
                .split('.')
                .map(|part| part.parse::<u32>().unwrap_or(0))
                .collect::<Vec<_>>()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chooses_numeric_version_and_keeps_profiles_separate() {
        let root = tempfile::tempdir().unwrap();
        for profile in ["Default", "Profile 1"] {
            for version in ["1.9", "1.10"] {
                let path = root
                    .path()
                    .join(profile)
                    .join("Extensions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                    .join(version);
                fs::create_dir_all(&path).unwrap();
                fs::write(
                    path.join("manifest.json"),
                    format!(r#"{{"manifest_version":3,"name":"test","version":"{version}"}}"#),
                )
                .unwrap();
            }
        }
        let found = scan(root.path()).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|entry| entry.manifest.version == "1.10"));
    }
}
