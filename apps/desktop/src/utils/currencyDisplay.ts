import type { CloudCurrencyRate } from "../types";
import {
  formatEstimatedCost, loadTokenCostDisplaySettings, TOKEN_COST_DISPLAY_EVENT, type TokenCostDisplaySettings,
} from "./tokenCost";

const CURRENCY_RATES_KEY = "codex-switch:display-currency-rates";
const CURRENCY_ALIASES: Record<string, string> = { "$": "USD", "美元": "USD", "美金": "USD",
  RMB: "CNY", "人民币": "CNY", "元": "CNY", "￥": "CNY" };

function validCurrency(value: unknown): value is CloudCurrencyRate {
  if (!value || typeof value !== "object") return false;
  const rate = value as Partial<CloudCurrencyRate>;
  return typeof rate.code === "string" && typeof rate.name === "string"
    && typeof rate.rate === "number" && Number.isFinite(rate.rate) && rate.rate > 0;
}

function loadCurrencyRates(): CloudCurrencyRate[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CURRENCY_RATES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(validCurrency) : [];
  } catch { return []; }
}

export function cacheDisplayCurrencyRates(currencies: CloudCurrencyRate[]) {
  try {
    const value = JSON.stringify(currencies.filter(validCurrency));
    if (window.localStorage.getItem(CURRENCY_RATES_KEY) === value) return;
    window.localStorage.setItem(CURRENCY_RATES_KEY, value);
    window.dispatchEvent(new CustomEvent(TOKEN_COST_DISPLAY_EVENT));
  } catch {
    // Currency queries must still succeed when browser storage is unavailable.
  }
}

/** Convert only recognized currencies with a known rate; provider credits keep their original unit. */
export function formatCurrencyAmount(amount: number, sourceUnit: string, settings = loadTokenCostDisplaySettings()) {
  const source = sourceUnit.trim();
  const code = CURRENCY_ALIASES[source.toUpperCase()] ?? source.toUpperCase();
  const rate = code === "USD" ? 1 : loadCurrencyRates().find((currency) => (
    currency.code === code || currency.name === source
  ))?.rate ?? (code === settings.currencyCode ? settings.usdMultiplier : undefined);
  return rate ? formatEstimatedCost(amount / rate, settings) : `${amount.toFixed(2)} ${source}`.trim();
}

export type CurrencyFormatter = (amount: number, sourceUnit: string) => string;

export function currencyFormatter(settings: TokenCostDisplaySettings): CurrencyFormatter {
  return (amount, unit) => formatCurrencyAmount(amount, unit, settings);
}
