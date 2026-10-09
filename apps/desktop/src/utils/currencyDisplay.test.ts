// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { cacheDisplayCurrencyRates, formatCurrencyAmount } from "./currencyDisplay";
import { formatTokenPrice, saveTokenCostDisplaySettings } from "./tokenCost";

beforeEach(() => localStorage.clear());

it("converts known source currencies through USD and preserves unknown credits", () => {
  cacheDisplayCurrencyRates([{ code: "CNY", name: "人民币", rate: 7 }]);
  saveTokenCostDisplaySettings({ unit: "积分", usdMultiplier: 100, currencyCode: null });
  expect(formatCurrencyAmount(2, "USD")).toBe("200.00 积分");
  expect(formatCurrencyAmount(14, "CNY")).toBe("200.00 积分");
  expect(formatCurrencyAmount(14, "人民币")).toBe("200.00 积分");
  expect(formatCurrencyAmount(14, "元")).toBe("200.00 积分");
  expect(formatCurrencyAmount(14, "credits")).toBe("14.00 credits");
  expect(formatCurrencyAmount(14, "EUR")).toBe("14.00 EUR");
});

it("uses the selected source currency rate when the currency list is unavailable", () => {
  saveTokenCostDisplaySettings({ unit: "人民币", usdMultiplier: 7, currencyCode: "CNY" });
  expect(formatCurrencyAmount(2, "USD")).toBe("14.00 人民币");
  expect(formatCurrencyAmount(14, "CNY")).toBe("14.00 人民币");
});

it("applies a custom multiplier even when the unit is called USD", () => {
  saveTokenCostDisplaySettings({ unit: "USD", usdMultiplier: 2, currencyCode: null });
  expect(formatCurrencyAmount(3, "USD")).toBe("6.00 USD");
  expect(formatCurrencyAmount(0, "USD")).toBe("0.00 USD");
  expect(formatCurrencyAmount(0.001, "USD")).toBe("0.0020 USD");
});

it("ignores invalid rates instead of producing invalid balances", () => {
  cacheDisplayCurrencyRates([{ code: "CNY", name: "人民币", rate: 0 }]);
  expect(formatCurrencyAmount(7, "CNY")).toBe("7.00 CNY");
});

it("keeps small converted model prices visible", () => {
  expect(formatTokenPrice(0.1, { unit: "unit", usdMultiplier: 0.000001, currencyCode: null }))
    .toBe("0.0000001");
});
