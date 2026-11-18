use super::*;

const MAX_PRESETS: usize = 1000;
const MAX_ALIASES: usize = 20;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CostPresetCatalog {
    pub(super) default_reference_model: String,
    pub(super) default_fast_mode_cost_multiplier: f64,
    pub(super) max_fast_mode_cost_multiplier: f64,
    pub(super) default_long_context_cost_settings: LongContextCostSettings,
    pub(super) max_long_context_threshold_tokens: u64,
    pub(super) max_long_context_cost_multiplier: f64,
    #[serde(default)]
    pub(super) unpriced_models: Vec<String>,
    pub(super) models: Vec<CostPreset>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CostPreset {
    pub(super) model: String,
    #[serde(default)]
    pub(super) aliases: Vec<String>,
    pub(super) long_context_pricing: bool,
    #[serde(default)]
    pub(super) long_context_threshold_tokens: Option<u64>,
    #[serde(default)]
    pub(super) fast_mode_multiplier: Option<f64>,
    #[serde(default)]
    pub(super) ultrafast_mode_multiplier: Option<f64>,
    #[serde(default)]
    source_url: String,
    #[serde(flatten)]
    pub(super) rate: CostRate,
}

/// Public, credential-free pricing document returned by the configured admin service.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteCostPresetDocument {
    models: Vec<CostPreset>,
    verified_at: String,
    source_url: String,
}

impl RemoteCostPresetDocument {
    pub(crate) fn is_valid(&self) -> bool {
        chrono::NaiveDate::parse_from_str(&self.verified_at, "%Y-%m-%d").is_ok()
            && valid_source(&self.source_url)
            && valid_presets(&self.models)
    }
}

fn valid_source(source: &str) -> bool {
    source.is_empty()
        || (source.len() <= 2048
            && reqwest::Url::parse(source).is_ok_and(|url| {
                url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            }))
}

fn valid_model_name(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 128
        && model
            .bytes()
            .next()
            .is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
        && model.bytes().all(|value| {
            value.is_ascii_lowercase() || value.is_ascii_digit() || b"._:/-".contains(&value)
        })
}

fn valid_presets(models: &[CostPreset]) -> bool {
    if models.is_empty() || models.len() > MAX_PRESETS {
        return false;
    }
    let mut names = std::collections::HashSet::new();
    models.iter().all(|preset| {
        preset.aliases.len() <= MAX_ALIASES
            && preset
                .long_context_threshold_tokens
                .is_none_or(long_context::valid_threshold)
            && valid_source(&preset.source_url)
            && [
                preset.rate.input,
                preset.rate.cached_input,
                preset.rate.output,
            ]
            .into_iter()
            .all(valid_rate)
            && preset
                .fast_mode_multiplier
                .is_none_or(valid_fast_multiplier)
            && preset
                .ultrafast_mode_multiplier
                .is_none_or(valid_fast_multiplier)
            && std::iter::once(&preset.model)
                .chain(&preset.aliases)
                .all(|name| valid_model_name(name) && names.insert(name))
    })
}

impl CostPresetCatalog {
    pub(super) fn is_valid(&self) -> bool {
        valid_presets(&self.models)
            && self.default_reference_model == PRESET_CATALOG.default_reference_model
            && self
                .preset_for_reference(&self.default_reference_model)
                .is_some()
            && self.unpriced_models.len() <= MAX_PRESETS
            && self
                .unpriced_models
                .iter()
                .all(|model| valid_model_name(model))
    }

    pub(super) fn rate_for_reference(&self, model: &str) -> Option<CostRate> {
        self.preset_for_reference(model).map(|preset| preset.rate)
    }

    pub(super) fn preset_for_reference(&self, model: &str) -> Option<&CostPreset> {
        self.models.iter().find(|preset| preset.model == model)
    }

    pub(super) fn rate_for_model(&self, model: &str) -> Option<CostRate> {
        self.preset_for_model(model).map(|preset| preset.rate)
    }

    pub(super) fn preset_for_model(&self, model: &str) -> Option<&CostPreset> {
        let normalized = model.trim().to_lowercase();
        if self.unpriced_models.iter().any(|unpriced| {
            normalized == *unpriced || normalized.starts_with(&format!("{unpriced}-"))
        }) {
            return None;
        }
        self.models
            .iter()
            .filter(|preset| {
                normalized == preset.model
                    || preset.aliases.contains(&normalized)
                    || normalized.starts_with(&format!("{}-", preset.model))
            })
            .max_by_key(|preset| preset.model.len())
    }

    pub(super) fn default_rate(&self) -> CostRate {
        // Both the bundled catalog and downloaded catalogs must contain their declared default.
        self.rate_for_reference(&self.default_reference_model)
            .expect("Validated token-cost catalog must contain its default reference model")
    }
}
