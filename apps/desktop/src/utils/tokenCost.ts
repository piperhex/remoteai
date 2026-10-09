import type { Provider, TokenUsageEntry } from "../types";
import { findTokenCostPreset, referenceTokenCostPreset } from "./tokenCostPresets";
import { costMultiplierForServiceTier } from "./tokenCostFastMode";
import { longContextMultipliersForEntry } from "./tokenCostLongContext";

const TOKENS_PER_MILLION = 1_000_000;
export const TOKEN_PRICE_DISPLAY_PRECISION = 12;
export const TOKEN_COST_DISPLAY_STORAGE_KEY = "codex-switch:token-cost-display";
export const TOKEN_COST_CUSTOM_RULES_STORAGE_KEY = "codex-switch:token-cost-custom-rules";
export const TOKEN_COST_DISPLAY_EVENT = "codex-switch:token-cost-display-changed";
export const TOKEN_COST_CUSTOM_RULES_EVENT = "codex-switch:token-cost-custom-rules-changed";

export interface TokenCostDisplaySettings {
  unit: string;
  usdMultiplier: number;
  currencyCode: string | null;
}

export const DEFAULT_TOKEN_COST_DISPLAY_SETTINGS: TokenCostDisplaySettings = {
  unit: "USD",
  usdMultiplier: 1,
  currencyCode: null,
};

export interface TokenCostRate {
  input: number;
  cachedInput: number;
  output: number;
}

export interface CustomTokenCostRule extends TokenCostRate {
  providerId: string;
  model: string;
}

let cachedCustomTokenCostRules: CustomTokenCostRule[] | null = null;

export function invalidateCustomTokenCostRulesCache() {
  cachedCustomTokenCostRules = null;
}

function providerForEntry(entry: TokenUsageEntry, providers: Provider[]) {
  if (entry.providerId) {
    return providers.find((provider) => provider.id === entry.providerId);
  }
  const name = entry.provider.trim().toLowerCase();
  return providers.find((provider) => provider.name.trim().toLowerCase() === name);
}

function matchesModel(configuredModel: string, entryModel: string) {
  const configured = configuredModel.trim().toLowerCase();
  const model = entryModel.trim().toLowerCase();
  return model === configured || model.startsWith(`${configured}-`);
}

export function findCustomTokenCostRule(
  rules: CustomTokenCostRule[],
  providerId: string | null | undefined,
  model: string,
) {
  if (!providerId) return undefined;
  return rules.filter((rule) => rule.providerId === providerId && matchesModel(rule.model, model))
    .sort((left, right) => right.model.trim().length - left.model.trim().length)[0];
}

function rateForEntry(
  entry: TokenUsageEntry,
  providers: Provider[],
  customRules: CustomTokenCostRule[],
): TokenCostRate {
  const provider = providerForEntry(entry, providers);
  const customRate = findCustomTokenCostRule(customRules, provider?.id ?? entry.providerId, entry.model);
  if (customRate) return customRate;
  const configured = provider?.modelTokenCosts?.[entry.model];
  if (provider?.kind === "custom") {
    if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
      return { input: configured, cachedInput: configured, output: configured };
    }
  }
  return findTokenCostPreset(entry.model) ?? referenceTokenCostPreset();
}

export function estimateTokenCost(entry: TokenUsageEntry, providers: Provider[]): number {
  const inputTokens = Math.max(0, entry.inputTokens ?? 0);
  const cachedTokens = Math.min(inputTokens, Math.max(0, entry.cachedTokens ?? 0));
  const outputTokens = Math.max(0, entry.outputTokens ?? 0);
  const rate = rateForEntry(entry, providers, loadCustomTokenCostRules());
  const context = longContextMultipliersForEntry(entry.model, inputTokens);
  return (
    (inputTokens - cachedTokens) * rate.input * context.input
    + cachedTokens * rate.cachedInput * context.cachedInput
    + outputTokens * rate.output * context.output
  ) / TOKENS_PER_MILLION * costMultiplierForServiceTier(entry.serviceTier, entry.model);
}

export function loadCustomTokenCostRules(): CustomTokenCostRule[] {
  if (cachedCustomTokenCostRules) return cachedCustomTokenCostRules;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOKEN_COST_CUSTOM_RULES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    cachedCustomTokenCostRules = parsed.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const rule = value as Partial<CustomTokenCostRule>;
      const providerId = typeof rule.providerId === "string" ? rule.providerId.trim() : "";
      const model = typeof rule.model === "string" ? rule.model.trim() : "";
      const rates = [rule.input, rule.cachedInput, rule.output];
      if (!providerId || !model || rates.some((rate) => (
        typeof rate !== "number" || !Number.isFinite(rate) || rate < 0
      ))) return [];
      return [{ providerId, model, input: rule.input!, cachedInput: rule.cachedInput!, output: rule.output! }];
    });
    return cachedCustomTokenCostRules;
  } catch {
    return [];
  }
}

export function saveCustomTokenCostRules(rules: CustomTokenCostRule[]) {
  const normalized = rules
    .map((rule) => ({
      providerId: rule.providerId.trim(),
      model: rule.model.trim(),
      input: rule.input,
      cachedInput: rule.cachedInput,
      output: rule.output,
    }))
    .filter((rule) => rule.providerId && rule.model && [rule.input, rule.cachedInput, rule.output]
      .every((rate) => Number.isFinite(rate) && rate >= 0));
  window.localStorage.setItem(TOKEN_COST_CUSTOM_RULES_STORAGE_KEY, JSON.stringify(normalized));
  cachedCustomTokenCostRules = normalized;
  window.dispatchEvent(new CustomEvent(TOKEN_COST_CUSTOM_RULES_EVENT));
}

export function loadTokenCostDisplaySettings(): TokenCostDisplaySettings {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOKEN_COST_DISPLAY_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
    }
    const value = parsed as Partial<TokenCostDisplaySettings>;
    const unit = typeof value.unit === "string" ? value.unit.trim().slice(0, 12) : "";
    const usdMultiplier = value.usdMultiplier;
    const currencyCode = typeof value.currencyCode === "string"
      && /^[A-Z]{3}$/.test(value.currencyCode.trim().toUpperCase())
      ? value.currencyCode.trim().toUpperCase()
      : null;
    if (!unit || typeof usdMultiplier !== "number" || !Number.isFinite(usdMultiplier) || usdMultiplier <= 0) {
      return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
    }
    return { unit, usdMultiplier, currencyCode };
  } catch {
    return DEFAULT_TOKEN_COST_DISPLAY_SETTINGS;
  }
}

export function saveTokenCostDisplaySettings(settings: TokenCostDisplaySettings) {
  window.localStorage.setItem(TOKEN_COST_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(TOKEN_COST_DISPLAY_EVENT));
}

export function formatEstimatedCostValue(value: number, settings = DEFAULT_TOKEN_COST_DISPLAY_SETTINGS) {
  const converted = Number.isFinite(value) ? value * settings.usdMultiplier : 0;
  return converted < 0.01 && converted > 0 ? converted.toFixed(4) : converted.toFixed(2);
}

export function formatEstimatedCost(value: number, settings = DEFAULT_TOKEN_COST_DISPLAY_SETTINGS) {
  return `${formatEstimatedCostValue(value, settings)} ${settings.unit}`;
}

export function formatTokenPrice(value: number, settings: TokenCostDisplaySettings) {
  return (value * settings.usdMultiplier).toLocaleString("en-US", {
    maximumFractionDigits: TOKEN_PRICE_DISPLAY_PRECISION,
  });
}

export function refreshTokenCostCurrencyRate(
  currencies: Array<{ code: string; name: string; rate: number }>,
) {
  const settings = loadTokenCostDisplaySettings();
  if (!settings.currencyCode) return false;
  const currency = currencies.find((item) => item.code === settings.currencyCode);
  if (!currency || !Number.isFinite(currency.rate) || currency.rate <= 0) return false;
  if (currency.rate === settings.usdMultiplier && currency.name === settings.unit) return false;
  saveTokenCostDisplaySettings({
    ...settings,
    unit: currency.name,
    usdMultiplier: currency.rate,
  });
  return true;
}
