use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn copy(source: &Path, destination: &Path) {
    if source.is_dir() {
        fs::create_dir_all(destination).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            copy(&entry.path(), &destination.join(entry.file_name()));
        }
    } else {
        fs::copy(source, destination).unwrap();
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=PROJECT_EDITOR_SOURCE");
    println!("cargo:rerun-if-changed=src/codex_gui.rs");
    let root = env::var_os("PROJECT_EDITOR_SOURCE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
                .join("../../apps/desktop/src-tauri/src/codex_gui")
        })
        .canonicalize()
        .unwrap();
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let service = output.join("service");
    fs::create_dir_all(&service).unwrap();
    for entry in [
        "project_editor.rs",
        "project_editor_tests.rs",
        "project_editor",
        "local_file.rs",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(entry).display());
        copy(&root.join(entry), &service.join(entry));
    }
    let adapters = fs::read_to_string("src/codex_gui.rs").unwrap();
    fs::write(
        service.join("mod.rs"),
        format!("mod project_editor;\nmod local_file;\n{}", adapters),
    )
    .unwrap();
    fs::write(
        output.join("services.rs"),
        format!(
            "#[path = {:?}] mod codex_gui;\n",
            service.join("mod.rs").to_string_lossy()
        ),
    )
    .unwrap();
}
