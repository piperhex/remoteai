    #[test]
    fn skin_verification_is_only_required_for_an_active_skin() {
        assert!(skin_verification_required(true, false));
        assert!(!skin_verification_required(false, false));
        assert!(!skin_verification_required(true, true));
    }

    #[test]
    fn managed_runtime_arguments_pair_cdp_with_a_non_default_profile() {
        let profile = PathBuf::from(
            r"C:\Users\Test User\AppData\Local\CodexDreamSkin\cdp-profile",
        );

        assert_eq!(
            managed_runtime_arguments(9335, &profile),
            vec![
                "--remote-debugging-address=127.0.0.1",
                "--remote-debugging-port=9335",
                r"--user-data-dir=C:\Users\Test User\AppData\Local\CodexDreamSkin\cdp-profile",
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_activation_quotes_profile_paths_with_spaces() {
        assert_eq!(
            quote_windows_argument(
                r"--user-data-dir=C:\Users\Test User\AppData\Local\CodexDreamSkin\cdp-profile",
            ),
            r#""--user-data-dir=C:\Users\Test User\AppData\Local\CodexDreamSkin\cdp-profile""#
        );
        assert_eq!(
            quote_windows_argument("--remote-debugging-port=9335"),
            "--remote-debugging-port=9335"
        );
    }

    #[test]
    fn ordinary_restarts_leave_skin_verification_to_the_monitor() {
        assert!(!wait_for_skin_verification(
            true,
            false,
            SkinVerificationMode::Background,
        ));
        assert!(wait_for_skin_verification(
            true,
            false,
            SkinVerificationMode::Required,
        ));
        assert!(!wait_for_skin_verification(
            false,
            false,
            SkinVerificationMode::Required,
        ));
    }

    #[test]
    fn verification_timeout_reason_is_never_empty() {
        let failed_main = vec![json!({ "result": { "pass": false } })];

        assert_eq!(
            verification_timeout_reason("", &failed_main),
            "the skin could not be confirmed in the Codex window"
        );
        assert_eq!(
            verification_timeout_reason("CDP unavailable", &[]),
            "CDP unavailable"
        );
        assert_eq!(
            verification_timeout_reason("", &[]),
            "no Codex main window was ready for verification"
        );
    }

    #[test]
    fn codex_26_727_renderer_contract_is_bundled() {
        let windows = include_str!("../../resources/dream-skin/assets/windows/renderer-inject.js");
        let macos = include_str!("../../resources/dream-skin/assets/macos/renderer-inject.js");

        for renderer in [windows, macos] {
            assert!(renderer.contains("[data-app-shell-main-surface]"));
            assert!(renderer.contains("[data-app-shell-header-edge-scroll]"));
            // 26.924 puts the fade state on the content panel; target only the decoration.
            assert!(renderer.contains("_MainContentTopFade_"));
            assert!(renderer.contains("[data-local-conversation-user-anchor]"));
            assert!(renderer.contains("[data-local-conversation-final-assistant]"));
        }
        assert!(windows.contains("[data-settings-panel-slug=\"general-settings\"]"));
    }

    #[test]
    fn codex_26_727_bootstrap_accepts_shell_and_settings_surfaces() {
        let payload = LoadedPayload {
            source: "window.__dreamSkinTest = true;".to_string(),
            revision: "codex-26-727".to_string(),
        };
        let early = early_payload(&payload);

        for source in [early.as_str(), CODEX_PROBE_PAYLOAD] {
            assert!(source.contains("[data-app-shell-main-surface]"));
            assert!(source.contains("[data-settings-panel-slug=\"general-settings\"]"));
            assert!(source.contains("location.protocol"));
        }
        assert!(VERIFY_PAYLOAD.contains("settingsPresent"));
        assert!(VERIFY_PAYLOAD.contains(SKIN_VERSION));
    }

    #[test]
    fn codex_26_803_composer_contract_is_bundled() {
        let windows = include_str!("../../resources/dream-skin/assets/windows/renderer-inject.js");
        let macos = include_str!("../../resources/dream-skin/assets/macos/renderer-inject.js");

        for renderer in [windows, macos] {
            assert!(renderer.contains("[data-composer-surface-variant]"));
            assert!(renderer.contains("[data-codex-composer-root] [data-composer-layout]"));
            assert!(renderer.contains("[data-composer-home-utility-bar-position]"));
            assert!(renderer.contains(".replaceAll(\".composer-surface-chrome\""));
        }
        assert!(windows.contains("existingStyle.textContent = compatibleCssText"));
        assert!(macos.contains("style.dataset.dreamSkinVersion !== VERSION"));
        assert!(VERIFY_PAYLOAD.contains("[data-codex-composer-root]"));
        assert!(VERIFY_PAYLOAD.contains("shellPresent"));
        assert!(VERIFY_PAYLOAD
            .contains("result.chromePresent && result.shellPresent && (result.sidebarPresent || result.titlebarPresent)"));
        assert!(!VERIFY_PAYLOAD
            .contains("result.chromePresent && result.sidebarPresent && result.composerPresent"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_payload_replaces_the_runtime_version_placeholder() {
        let template = include_str!("../../resources/dream-skin/assets/windows/renderer-inject.js");
        let payload = render_payload(
            template,
            "html { color: red; }",
            "data:image/png;base64,AA==",
            &json!({ "id": "test-theme" }),
        )
        .unwrap();

        for placeholder in [
            "__DREAM_CSS_JSON__",
            "__DREAM_ART_JSON__",
            "__DREAM_THEME_JSON__",
            "__DREAM_SKIN_VERSION_JSON__",
        ] {
            assert!(!payload.source.contains(placeholder));
        }
        assert!(payload.source.contains(SKIN_VERSION));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn restores_store_identity_for_a_running_or_remembered_executable() {
        let packaged_executable = PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0.0.0_x64__example\app\ChatGPT.exe",
        );
        let direct_install = CodexInstall {
            // std::fs::canonicalize and process inspection can return this
            // verbatim form even though PackageManager returns a DOS path.
            executable: PathBuf::from(
                r"\\?\C:\Program Files\WindowsApps\OpenAI.Codex_1.0.0.0_x64__example\app\ChatGPT.exe",
            ),
            app_user_model_id: None,
        };
        let packaged_installs = vec![(
            (1, 0, 0, 0),
            CodexInstall {
                executable: packaged_executable,
                app_user_model_id: Some("OpenAI.Codex_example!App".to_string()),
            },
        )];

        let resolved = attach_matching_package_identity(direct_install, &packaged_installs);

        assert_eq!(
            resolved.app_user_model_id.as_deref(),
            Some("OpenAI.Codex_example!App")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn keeps_an_existing_store_identity_when_matching_packages_change() {
        let executable = PathBuf::from(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0.0.0_x64__example\app\ChatGPT.exe",
        );
        let identified_install = CodexInstall {
            executable: executable.clone(),
            app_user_model_id: Some("OpenAI.Codex_example!App".to_string()),
        };
        let packaged_installs = vec![(
            (2, 0, 0, 0),
            CodexInstall {
                executable,
                app_user_model_id: Some("replacement!App".to_string()),
            },
        )];

        let resolved = attach_matching_package_identity(identified_install, &packaged_installs);

        assert_eq!(
            resolved.app_user_model_id.as_deref(),
            Some("OpenAI.Codex_example!App")
        );
    }

    #[test]
    fn bundled_themes_are_loadable() {
        let bundled_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin");
        for theme_id in BUILT_IN_THEME_IDS {
            let directory = built_in_theme_directory(&bundled_root, theme_id)
                .unwrap_or_else(|error| panic!("{theme_id} directory is invalid: {error}"));
            let theme = load_theme(&directory)
                .unwrap_or_else(|error| panic!("{theme_id} failed to load: {error}"));
            assert_eq!(theme.document["id"], theme_id);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_discovers_current_and_legacy_app_names() {
        let applications_dir = std::env::temp_dir().join(format!(
            "codex-switch-macos-install-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let chatgpt = applications_dir
            .join("ChatGPT.app")
            .join("Contents")
            .join("MacOS")
            .join("ChatGPT");
        let codex = applications_dir
            .join("Codex.app")
            .join("Contents")
            .join("MacOS")
            .join("Codex");
        fs::create_dir_all(chatgpt.parent().unwrap()).unwrap();
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(&chatgpt, b"").unwrap();
        fs::write(&codex, b"").unwrap();

        let current = find_macos_codex_install_in(&applications_dir).unwrap();
        assert_eq!(current.executable, chatgpt);

        fs::remove_file(&chatgpt).unwrap();
        let legacy = find_macos_codex_install_in(&applications_dir).unwrap();
        assert_eq!(legacy.executable, codex);

        fs::remove_dir_all(applications_dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires the official ChatGPT/Codex application"]
    fn discovers_official_codex_application() {
        let install = find_default_codex_install()
            .expect("official ChatGPT/Codex application should be discoverable");
        assert!(
            install
                .executable
                .ends_with("ChatGPT.app/Contents/MacOS/ChatGPT")
                || install
                    .executable
                    .ends_with("Codex.app/Contents/MacOS/Codex")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires the official Codex Store package"]
    fn discovers_official_codex_package() {
        let install =
            find_default_codex_install().expect("official Codex package should be discoverable");
        assert!(install.executable.ends_with("app\\ChatGPT.exe"));
        assert!(install.app_user_model_id.is_some_and(|id| id.contains('!')));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires a running official Codex Store app"]
    fn restores_identity_for_the_running_codex_package() {
        let install =
            find_running_codex_install().expect("the running Codex package should be discoverable");
        assert!(install.executable.ends_with("app\\ChatGPT.exe"));
        assert!(install.app_user_model_id.is_some_and(|id| id.contains('!')));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "restarts the locally installed Codex app"]
    fn launches_and_injects_with_native_runtime() {
        let bundled_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dream-skin");
        initialize_store().expect("theme store should initialize");
        write_json(
            &marker_path().unwrap(),
            &InstallationMarker {
                schema_version: 1,
                runtime: "rust-native".to_string(),
                version: NATIVE_RUNTIME_VERSION.to_string(),
            },
        )
        .unwrap();
        write_session(&NativeSessionState::default()).unwrap();
        restart_managed_runtime(
            &RuntimePaths {
                bundled_root,
            },
            SkinVerificationMode::Required,
        )
        .expect("native runtime should launch and inject Codex");
    }
