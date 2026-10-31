include!("files.rs");
include!("account_paths.rs");
include!("account_metadata.rs");
include!("settings_and_import.rs");
include!("quota_display_settings.rs");
include!("quota_window_sync_settings.rs");
include!("tests.rs");

mod interface_copy;
mod language_settings;
mod model_context_settings;
pub(crate) use interface_copy::{callback_page_copy, native_text};
#[cfg(test)]
pub(crate) use language_settings::with_interface_language;
pub(crate) use language_settings::{
    interface_language, is_supported_interface_language, save_app_language, InterfaceLanguage,
};
pub(crate) use model_context_settings::{update_model_context_window, ModelContextWindowUpdate};

#[cfg(test)]
mod app_settings_tests;
