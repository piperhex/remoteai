#[path = "build_support/service_manifest.rs"]
mod service_manifest;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let source = "src/provider_browser/platform/mapping_domains.m";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new()
            .file(source)
            .flag("-fobjc-arc")
            .compile("browser_mapping_domains");
        println!("cargo:rustc-link-lib=framework=Network");
    }
    service_manifest::generate();
    tauri_build::build();

    #[cfg(windows)]
    link_windows_resources_to_tests();
}

#[cfg(windows)]
fn link_windows_resources_to_tests() {
    let output_dir = std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR");
    // `rustc-link-arg-tests` only reaches integration tests. The cfg(test) link
    // in windows_test_resources also covers explicit `--lib` / `--all-targets`.
    println!(
        "cargo:rustc-link-search=native={}",
        std::path::PathBuf::from(output_dir).display()
    );
}
