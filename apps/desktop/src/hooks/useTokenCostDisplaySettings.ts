import { useEffect, useState } from "react";
import { loadTokenCostDisplaySettings, TOKEN_COST_DISPLAY_EVENT } from "../utils/tokenCost";
import { currencyFormatter } from "../utils/currencyDisplay";

export function useTokenCostDisplaySettings() {
  const [settings, setSettings] = useState(() => ({ ...loadTokenCostDisplaySettings() }));
  useEffect(() => {
    const refresh = () => setSettings({ ...loadTokenCostDisplaySettings() });
    window.addEventListener(TOKEN_COST_DISPLAY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(TOKEN_COST_DISPLAY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return settings;
}

export function useCurrencyFormatter() {
  return currencyFormatter(useTokenCostDisplaySettings());
}
