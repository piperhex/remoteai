use super::context_windows_from_catalog;
use serde_json::json;
use std::collections::BTreeMap;

#[test]
fn context_defaults_use_raw_per_model_capacities() {
    let catalog = json!({"models": [
        {"slug": "first", "context_window": 272000, "max_context_window": 1000000,
            "effective_context_window_percent": 95},
        {"id": "second", "max_context_window": 400000},
        {"slug": "hidden", "visibility": "hide", "context_window": 128000}
    ]});
    assert_eq!(
        context_windows_from_catalog(&catalog),
        BTreeMap::from([
            ("first".into(), 272000),
            ("second".into(), 400000),
            ("hidden".into(), 128000),
        ])
    );
}

#[test]
fn context_defaults_skip_unknown_values_and_use_valid_maximum_as_fallback() {
    let catalog = json!({"models": [null, {},
        {"slug": "" , "context_window": 128000},
        {"slug": "unknown"}, {"slug": "invalid", "context_window": -1},
        {"slug": "zero", "context_window": 0, "max_context_window": 384000}
    ]});
    assert_eq!(
        context_windows_from_catalog(&catalog),
        BTreeMap::from([("zero".into(), 384000)])
    );
    assert!(context_windows_from_catalog(&json!({})).is_empty());
}
