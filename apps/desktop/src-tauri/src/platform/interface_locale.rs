/// Expose Linux's message locale before the first page renders. WebKit's
/// navigator.language can follow a different locale category in mixed locales.
/// Other platforms continue to use their WebView's native language detection.
pub(crate) fn initialization_script() -> String {
    #[cfg(target_os = "linux")]
    {
        script_from_environment(|name| std::env::var(name).ok())
    }
    #[cfg(not(target_os = "linux"))]
    String::new()
}

#[cfg(any(target_os = "linux", test))]
fn script_from_environment(read: impl Fn(&str) -> Option<String>) -> String {
    let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|name| read(name))
        .find(|value| !value.trim().is_empty());
    let Some(locale) = locale else {
        return String::new();
    };
    // Serialize the environment value as data, never as executable JavaScript.
    let value = match serde_json::to_string(locale.trim()) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Could not encode the interface locale: {error}");
            return String::new();
        }
    };
    format!(
        "Object.defineProperty(globalThis, '__REMOTE_AI_SYSTEM_LOCALE__', {{ value: {value} }});"
    )
}

#[cfg(test)]
mod tests {
    use super::script_from_environment;

    fn script(values: &[(&str, &str)]) -> String {
        script_from_environment(|name| {
            values
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        })
    }

    #[test]
    fn lc_all_overrides_the_message_locale_and_lang() {
        let output = script(&[
            ("LC_ALL", "C.UTF-8"),
            ("LC_MESSAGES", "zh_CN.UTF-8"),
            ("LANG", "fr_FR.UTF-8"),
        ]);
        assert!(output.contains("\"C.UTF-8\""));
        assert!(!output.contains("zh_CN"));
    }

    #[test]
    fn message_locale_overrides_lang_and_empty_values_are_skipped() {
        let output = script(&[
            ("LC_ALL", " "),
            ("LC_MESSAGES", "zh_TW.UTF-8"),
            ("LANG", "en_US.UTF-8"),
        ]);
        assert!(output.contains("\"zh_TW.UTF-8\""));
        assert!(script(&[("LANG", " fr_FR.UTF-8 ")]).contains("\"fr_FR.UTF-8\""));
        assert!(script(&[]).is_empty());
    }

    #[test]
    fn treats_quotes_and_newlines_as_locale_data() {
        let output = script(&[("LANG", "zh_CN\";alert(1);\n")]);
        assert!(output.contains("\"zh_CN\\\";alert(1);\""));
        assert_eq!(output.lines().count(), 1);
    }
}
