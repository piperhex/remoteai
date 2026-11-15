//! One host preference shared by GUI browser tools and the Chrome MCP process.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Target {
    Chrome,
    AgentHub,
    Standalone,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Preferences {
    pub order: Vec<Target>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            order: vec![Target::Chrome, Target::AgentHub, Target::Standalone],
        }
    }
}

impl Preferences {
    pub fn validate(&self) -> super::extensions::Result<()> {
        let expected = Self::default().order;
        if self.order.len() != expected.len()
            || expected.iter().any(|item| !self.order.contains(item))
        {
            return Err(super::extensions::Error::Invalid);
        }
        Ok(())
    }

    pub fn builtin(&self) -> Target {
        self.order
            .iter()
            .copied()
            .find(|item| *item != Target::Chrome)
            .unwrap_or(Target::AgentHub)
    }

    pub fn response(&self) -> Value {
        json!({"order": self.order, "instructions":
            "Use this browser order unless the user explicitly selects an entry point. agentHub opens in the \
             conversation's AgentHub sidebar; standalone opens the menu browser. These are distinct destinations. \
             Skip unavailable choices without repeated retries. Preserve Chrome pause and site permissions, \
             existing sessions, and all consent rules. Never repeat an uncertain submission after switching."})
    }
}

fn path() -> super::extensions::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("CSW_CHROME_TEST_ROOT") {
        let root = PathBuf::from(root);
        if root.is_absolute() && root.parent().is_some() {
            return Ok(root.join("browser-assistant.json"));
        }
        return Err(super::extensions::Error::Invalid);
    }
    dirs::data_dir()
        .map(|root| root.join("dev.codex.switch/browser-assistant.json"))
        .ok_or(super::extensions::Error::Storage)
}

pub(crate) fn load() -> super::extensions::Result<Preferences> {
    let bytes = match std::fs::read(path()?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Preferences::default())
        }
        Err(_) => return Err(super::extensions::Error::Storage),
    };
    let preferences: Preferences =
        serde_json::from_slice(&bytes).map_err(|_| super::extensions::Error::Storage)?;
    preferences.validate()?;
    Ok(preferences)
}

pub(crate) fn save(preferences: Preferences) -> super::extensions::Result<Value> {
    preferences.validate()?;
    let path = path()?;
    let parent = path.parent().ok_or(super::extensions::Error::Storage)?;
    std::fs::create_dir_all(parent).map_err(|_| super::extensions::Error::Storage)?;
    crate::storage::write_json_atomic(&path, &json!(preferences))
        .map_err(|_| super::extensions::Error::Storage)?;
    Ok(json!({"preferences": preferences.response()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_keeps_chrome_first_and_agenthub_before_menu_browser() {
        let preferences = Preferences::default();
        assert_eq!(
            preferences.order,
            [Target::Chrome, Target::AgentHub, Target::Standalone]
        );
        assert_eq!(preferences.builtin(), Target::AgentHub);
    }

    #[test]
    fn all_three_entries_are_required_once_and_builtin_order_is_respected() {
        let preferences = Preferences {
            order: vec![Target::Standalone, Target::Chrome, Target::AgentHub],
        };
        assert!(preferences.validate().is_ok());
        assert_eq!(preferences.builtin(), Target::Standalone);
        assert!(Preferences {
            order: vec![Target::Chrome, Target::Chrome, Target::Standalone]
        }
        .validate()
        .is_err());
    }
}
