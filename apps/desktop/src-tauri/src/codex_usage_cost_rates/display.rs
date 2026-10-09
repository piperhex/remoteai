use serde::{Deserialize, Serialize};

const MAX_UNIT_LENGTH: usize = 12;

/// Presentation preferences never change the USD amounts used for accounting.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CostDisplaySettings {
    unit: String,
    usd_multiplier: f64,
}

impl Default for CostDisplaySettings {
    fn default() -> Self {
        Self {
            unit: "USD".to_string(),
            usd_multiplier: 1.0,
        }
    }
}

impl CostDisplaySettings {
    pub(super) fn is_valid(&self) -> bool {
        !self.unit.trim().is_empty()
            && self.unit.chars().count() <= MAX_UNIT_LENGTH
            && !self.unit.chars().any(char::is_control)
            && self.usd_multiplier.is_finite()
            && self.usd_multiplier > 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_default_and_custom_units() {
        assert!(CostDisplaySettings::default().is_valid());
        assert!(CostDisplaySettings {
            unit: "积分".into(),
            usd_multiplier: 100.0
        }
        .is_valid());
    }

    #[test]
    fn rejects_invalid_display_settings() {
        for multiplier in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(!CostDisplaySettings {
                unit: "USD".into(),
                usd_multiplier: multiplier
            }
            .is_valid());
        }
        for unit in ["", " ", "a\nb", "1234567890123"] {
            assert!(!CostDisplaySettings {
                unit: unit.into(),
                usd_multiplier: 1.0
            }
            .is_valid());
        }
    }
}
