use std::{
    collections::BTreeMap,
    fmt, fs, io,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    models::{ProviderKind, ProviderProfile, TokenUsageEntry},
    storage::Paths,
};

mod catalog;
mod display;
mod long_context;

pub(crate) use catalog::RemoteCostPresetDocument;
use catalog::{CostPreset, CostPresetCatalog};
pub(crate) use display::CostDisplaySettings;

use long_context::LongContextCostSettings;

const RATES_FILE_NAME: &str = "codex-usage-cost-rates.json";
const MAX_RULES: usize = 10_000;
const MAX_MODEL_PRICES: usize = 100_000;
const MAX_IDENTIFIER_LENGTH: usize = 512;
const MAX_TOKEN_RATE: f64 = 1_000_000_000.0;
const TOKENS_PER_MILLION: f64 = 1_000_000.0;
static RATES_WRITE_LOCK: Mutex<()> = Mutex::new(());
static PRESET_CATALOG: LazyLock<CostPresetCatalog> = LazyLock::new(|| {
    // This is a bundled build artifact; malformed data cannot be repaired at runtime.
    serde_json::from_str(include_str!("../../src/data/tokenCostPresets.json"))
        .expect("The bundled token-cost preset catalog must be valid JSON")
});

/// A desktop copy of the existing price settings, in USD per million tokens.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CostRates {
    #[serde(default)]
    pub(crate) display: CostDisplaySettings,
    #[serde(default = "default_reference_model")]
    reference_model: String,
    #[serde(default)]
    fast_mode_multiplier: Option<f64>,
    #[serde(default)]
    model_fast_mode_multipliers: BTreeMap<String, Option<f64>>,
    #[serde(default)]
    preset_catalog: Option<CostPresetCatalog>,
    #[serde(default)]
    long_context: LongContextCostSettings,
    #[serde(default)]
    custom_rules: Vec<CustomCostRule>,
    #[serde(default)]
    model_token_costs: BTreeMap<String, BTreeMap<String, f64>>,
}

impl Default for CostRates {
    fn default() -> Self {
        Self {
            display: CostDisplaySettings::default(),
            reference_model: default_reference_model(),
            fast_mode_multiplier: None,
            model_fast_mode_multipliers: BTreeMap::new(),
            preset_catalog: None,
            long_context: LongContextCostSettings::default(),
            custom_rules: Vec::new(),
            model_token_costs: BTreeMap::new(),
        }
    }
}

fn default_reference_model() -> String {
    PRESET_CATALOG.default_reference_model.clone()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomCostRule {
    provider_id: String,
    model: String,
    #[serde(flatten)]
    rate: CostRate,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CostRate {
    input: f64,
    cached_input: f64,
    output: f64,
}

#[derive(Debug)]
enum CostRatesError {
    Invalid,
    Unavailable,
}

impl fmt::Display for CostRatesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "预估成本价格设置无效。",
            Self::Unavailable => "暂时无法更新预估成本价格，请稍后重试。",
        })
    }
}

impl std::error::Error for CostRatesError {}

impl CostRate {
    const fn new(input: f64, cached_input: f64, output: f64) -> Self {
        Self {
            input,
            cached_input,
            output,
        }
    }

    fn estimate(self, entry: &TokenUsageEntry) -> f64 {
        let input = entry.input_tokens.unwrap_or(0);
        let cached = entry.cached_tokens.unwrap_or(0).min(input);
        let output = entry.output_tokens.unwrap_or(0);
        ((input - cached) as f64 * self.input
            + cached as f64 * self.cached_input
            + output as f64 * self.output)
            / TOKENS_PER_MILLION
    }
}

impl CostRates {
    // Native summaries currently consume estimates only on Windows and macOS.
    #[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
    pub(crate) fn estimate_cost(
        &self,
        entry: &TokenUsageEntry,
        provider: Option<&ProviderProfile>,
    ) -> f64 {
        let catalog = self.catalog();
        let provider_id = provider
            .map(|provider| provider.id.as_str())
            .or(entry.provider_id.as_deref());
        let configured = provider
            .filter(|provider| provider.kind == ProviderKind::Custom)
            .and_then(|provider| self.model_token_costs.get(&provider.id))
            .and_then(|models| models.get(&entry.model))
            .map(|rate| CostRate::new(*rate, *rate, *rate));
        let rate = self
            .custom_rate(provider_id, &entry.model)
            .or(configured)
            .or_else(|| catalog.rate_for_model(&entry.model))
            .or_else(|| catalog.rate_for_reference(&self.reference_model))
            .unwrap_or_else(|| catalog.default_rate());
        let multiplier = match entry.service_tier.as_deref() {
            Some("priority" | "fast") => self.fast_multiplier_for_model(&entry.model),
            _ => 1.0,
        };
        self.long_context
            .adjust_rate(rate, entry, self.preset_for_entry(&entry.model))
            .estimate(entry)
            * multiplier
    }

    fn catalog(&self) -> &CostPresetCatalog {
        self.preset_catalog.as_ref().unwrap_or(&PRESET_CATALOG)
    }

    fn preset_for_entry(&self, model: &str) -> Option<&CostPreset> {
        let catalog = self.catalog();
        catalog
            .preset_for_model(model)
            .or_else(|| catalog.preset_for_reference(&self.reference_model))
            .or_else(|| catalog.preset_for_reference(&catalog.default_reference_model))
    }

    fn fast_multiplier_for_model(&self, model: &str) -> f64 {
        let preset = self.preset_for_entry(model);
        let model_multiplier = preset
            .and_then(|preset| preset.fast_mode_multiplier)
            .unwrap_or(1.0);
        let custom = preset.and_then(|preset| self.model_fast_mode_multipliers.get(&preset.model));
        match custom {
            Some(Some(multiplier)) => *multiplier,
            Some(None) => model_multiplier,
            None => self.fast_mode_multiplier.unwrap_or(model_multiplier),
        }
    }

    fn custom_rate(&self, provider_id: Option<&str>, model: &str) -> Option<CostRate> {
        let provider_id = provider_id?;
        let model = model.trim().to_lowercase();
        // A model-specific override wins over a broader version-prefix rule.
        self.custom_rules
            .iter()
            .filter(|rule| {
                let configured = rule.model.trim().to_lowercase();
                rule.provider_id == provider_id
                    && (model == configured || model.starts_with(&format!("{configured}-")))
            })
            .min_by_key(|rule| std::cmp::Reverse(rule.model.trim().len()))
            .map(|rule| rule.rate)
    }

    fn validate(&self) -> Result<(), CostRatesError> {
        let rule_count_valid = self.custom_rules.len() <= MAX_RULES;
        let prices_count_valid = self.model_token_costs.len() <= MAX_RULES
            && self
                .model_token_costs
                .values()
                .map(BTreeMap::len)
                .sum::<usize>()
                <= MAX_MODEL_PRICES;
        let rules_valid = self.custom_rules.iter().all(|rule| {
            valid_identifier(&rule.provider_id)
                && valid_identifier(&rule.model)
                && [rule.rate.input, rule.rate.cached_input, rule.rate.output]
                    .into_iter()
                    .all(valid_rate)
        });
        let prices_valid = self.model_token_costs.iter().all(|(provider, models)| {
            valid_identifier(provider)
                && models
                    .iter()
                    .all(|(model, rate)| valid_identifier(model) && valid_rate(*rate))
        });
        let reference_valid = self
            .catalog()
            .rate_for_reference(&self.reference_model)
            .is_some();
        let multiplier_valid = self.fast_mode_multiplier.is_none_or(valid_fast_multiplier)
            && self.model_fast_mode_multipliers.len() <= MAX_RULES
            && self
                .model_fast_mode_multipliers
                .iter()
                .all(|(model, value)| {
                    valid_identifier(model) && value.is_none_or(valid_fast_multiplier)
                });
        let catalog_valid = self
            .preset_catalog
            .as_ref()
            .is_none_or(CostPresetCatalog::is_valid);
        if reference_valid
            && self.display.is_valid()
            && catalog_valid
            && multiplier_valid
            && self.long_context.is_valid()
            && rule_count_valid
            && prices_count_valid
            && rules_valid
            && prices_valid
        {
            Ok(())
        } else {
            Err(CostRatesError::Invalid)
        }
    }
}

fn valid_fast_multiplier(value: f64) -> bool {
    value.is_finite() && value > 0.0 && value <= PRESET_CATALOG.max_fast_mode_cost_multiplier
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_IDENTIFIER_LENGTH
}

fn valid_rate(value: f64) -> bool {
    value.is_finite() && (0.0..=MAX_TOKEN_RATE).contains(&value)
}

fn rates_path(paths: &Paths) -> PathBuf {
    paths.state_file.with_file_name(RATES_FILE_NAME)
}

// Every platform saves rates; only native Windows/macOS summaries load them.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub(crate) fn load(paths: &Paths) -> Result<CostRates, String> {
    read_rates(paths).map_err(|error| error.to_string())
}

fn read_rates(paths: &Paths) -> Result<CostRates, CostRatesError> {
    let bytes = match fs::read(rates_path(paths)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(CostRates::default()),
        Err(_) => return Err(CostRatesError::Unavailable),
    };
    let rates: CostRates = serde_json::from_slice(&bytes).map_err(|_| CostRatesError::Invalid)?;
    rates.validate()?;
    Ok(rates)
}

fn persist(paths: &Paths, rates: &CostRates) -> Result<bool, CostRatesError> {
    rates.validate()?;
    let _guard = RATES_WRITE_LOCK
        .lock()
        .map_err(|_| CostRatesError::Unavailable)?;
    let value = serde_json::to_value(rates).map_err(|_| CostRatesError::Invalid)?;
    crate::storage::write_json_if_changed(&rates_path(paths), &value)
        .map_err(|_| CostRatesError::Unavailable)
}

#[tauri::command]
pub(crate) async fn set_codex_usage_cost_rates(
    app: tauri::AppHandle,
    rates: CostRates,
) -> Result<(), String> {
    let changed = tauri::async_runtime::spawn_blocking(move || {
        let paths = crate::storage::resolve_paths(&app).map_err(|_| CostRatesError::Unavailable)?;
        persist(&paths, &rates)
    })
    .await
    .map_err(|_| CostRatesError::Unavailable.to_string())?
    .map_err(|error| error.to_string())?;
    if changed {
        crate::codex_runtime::refresh_usage_summary();
    }
    Ok(())
}

#[cfg(test)]
mod tests;
