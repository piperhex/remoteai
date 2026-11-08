//! Pinned Remote AI CUA packages; macOS preserves the upstream host-attributed runtime.
use super::{ComputerError, Result};

#[derive(Clone, Copy)]
pub(super) enum ArchiveFormat {
    Zip,
    TarGz,
}

pub(super) struct Asset {
    pub target: &'static str,
    pub suffix: &'static str,
    pub digest: &'static str,
    pub format: ArchiveFormat,
    pub files: &'static [&'static str],
}

const WINDOWS_FILES: &[&str] = &[
    "cua-driver.exe",
    "cua-driver-uia.exe",
    "cua-cursor-theme.exe",
    "cua_driver_sdk.dll",
    "cua_driver_node_runtime.node",
    "cua_driver_abi.h",
];
const MACOS_FILES: &[&str] = &[
    "cua-driver",
    "cua-cursor-theme",
    "libcua_driver_sdk.dylib",
    "cua_driver_node_runtime.node",
    "cua_driver_abi.h",
];

impl Asset {
    pub fn executable(&self) -> &'static str {
        self.files[0]
    }
}

pub(super) fn select(os: &str, architecture: &str) -> Result<Asset> {
    let (target, digest) = match (os, architecture) {
        ("macos", "x86_64" | "aarch64") => {
            return Ok(Asset {
                target: "darwin-universal",
                suffix: "-binary.tar.gz",
                digest: "7d491f67f54be5f3b380ffd85c64b242eaefd05dad6df78012cde227c95aee2a",
                format: ArchiveFormat::TarGz,
                files: MACOS_FILES,
            })
        }
        ("windows", "x86_64") => (
            "windows-x86_64",
            "37ca2f2cea45000fba4f1ad4bcf4e2139e871d4c8aa80cb8b61e74a022d20d54",
        ),
        ("windows", "aarch64") => (
            "windows-arm64",
            "996f8c5ecbf54b91d1ad34639d383a239fc2905e754ce736c82fbf9be50f1e51",
        ),
        _ => return Err(ComputerError::Unsupported),
    };
    Ok(Asset {
        target,
        digest,
        suffix: ".zip",
        format: ArchiveFormat::Zip,
        files: WINDOWS_FILES,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_native_packages_without_changing_windows_cache_paths() {
        for architecture in ["aarch64", "x86_64"] {
            let mac = select("macos", architecture).unwrap();
            assert_eq!(mac.target, "darwin-universal");
            assert_eq!(mac.suffix, "-binary.tar.gz");
            assert_eq!(mac.executable(), "cua-driver");
            let windows = select("windows", architecture).unwrap();
            assert_eq!(windows.executable(), "cua-driver.exe");
            assert!(windows.target.starts_with("windows-"));
        }
        assert!(select("linux", "x86_64").is_err());
        assert!(select("macos", "x86").is_err());
    }
}
