import { useEffect, useState } from "react";
import { BASE_CURRENCY_RATE, fetchCloudCurrencyRates } from "../api/backend";
import type { CloudCurrencyRate } from "../types";
import { saveTokenCostDisplaySettings, type TokenCostDisplaySettings } from "../utils/tokenCost";

export function useTokenCostDisplayEditor(settings: TokenCostDisplaySettings) {
  const [unit, setUnit] = useState(settings.unit);
  const [usdMultiplier, setUsdMultiplier] = useState<number | null>(settings.usdMultiplier);
  const [currencyCode, setCurrencyCode] = useState(settings.currencyCode);
  const [currencies, setCurrencies] = useState<CloudCurrencyRate[]>([BASE_CURRENCY_RATE]);
  const [loading, setLoading] = useState(true);
  const valid = Boolean(unit.trim() && usdMultiplier && Number.isFinite(usdMultiplier) && usdMultiplier > 0);
  useEffect(() => {
    let active = true;
    void fetchCloudCurrencyRates().then((result) => {
      if (active) setCurrencies(result.currencies);
    }).catch(() => {
      // Custom units remain available when the currency list cannot be loaded.
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = () => {
    if (!valid || usdMultiplier == null) return false;
    saveTokenCostDisplaySettings({ unit: unit.trim().slice(0, 12), usdMultiplier, currencyCode });
    return true;
  };
  const selectCurrency = (code: string | undefined) => {
    setCurrencyCode(code ?? null);
    const currency = currencies.find((item) => item.code === code);
    if (currency) { setUnit(currency.name); setUsdMultiplier(currency.rate); }
  };
  const changeUnit = (value: string) => { setCurrencyCode(null); setUnit(value); };
  return { unit, usdMultiplier, currencyCode, currencies, loading, valid,
    save, selectCurrency, changeUnit, setUsdMultiplier };
}
