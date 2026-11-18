import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { TokenCostPresets } from "../src/components/TokenCostPresets";
import { TokenPricingPage } from "../../admin-ui/src/pages/TokenPricingPage";
import { I18nProvider } from "../../admin-ui/src/i18n-context";
import { translate, type Translate } from "../src/i18n";
import { estimateTokenCost } from "../src/utils/tokenCost";
import { FAST_MODE_COST_MULTIPLIER_EVENT } from "../src/utils/tokenCostFastMode";
import { LONG_CONTEXT_COST_EVENT } from "../src/utils/tokenCostLongContext";
import { applyTokenCostPresets, TOKEN_COST_REFERENCE_MODEL_EVENT } from "../src/utils/tokenCostPresets";
import "antd/dist/reset.css";
import "../src/styles.css";

const t: Translate = (key, values) => translate("zh", key, values);
const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error("Request failed");
  return response.json() as Promise<T>;
};
function DesktopPrices() {
  const [reference, setReference] = useState("gpt-5.6-sol");
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    window.addEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, update);
    window.addEventListener(LONG_CONTEXT_COST_EVENT, update);
    window.addEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, update);
    void api<unknown>("/token-cost-presets").then(applyTokenCostPresets).catch(() => {});
    return () => {
      window.removeEventListener(FAST_MODE_COST_MULTIPLIER_EVENT, update);
      window.removeEventListener(LONG_CONTEXT_COST_EVENT, update);
      window.removeEventListener(TOKEN_COST_REFERENCE_MODEL_EVENT, update);
    };
  }, []);
  const cost = estimateTokenCost({ id: "usage", ts: 0, provider: "", model: "gpt-6-sol",
    inputTokens: 100_000, outputTokens: 10_000, cachedTokens: 0,
    serviceTier: new URLSearchParams(location.search).get("tier") ?? "fast" }, []);
  return <><output aria-label="预估费用">{cost.toFixed(2)}</output>
    <TokenCostPresets referenceModel={reference} onReferenceChange={setReference} t={t} /></>;
}
createRoot(document.getElementById("root")!).render(<ConfigProvider><App>
  <main style={{ padding: 24, maxWidth: 1500, margin: "auto" }}>
    {location.search.includes("admin")
      ? <I18nProvider language="zh" onLanguageChange={() => {}}>
        <TokenPricingPage api={api} canManage={!location.search.includes("readonly")} />
      </I18nProvider>
      : <DesktopPrices />}
  </main>
</App></ConfigProvider>);
