import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AutoComplete, Button, InputNumber, Select } from "antd";
import { DollarSign, Trash2, X } from "lucide-react";
import type { Provider } from "../types";
import type { Translate } from "../i18n";
import { useCustomTokenCostEditor } from "../hooks/useCustomTokenCostEditor";
import { loadTokenCostReferenceModel, saveTokenCostReferenceModel } from "../utils/tokenCostPresets";
import { TokenCostPresets } from "./TokenCostPresets";
import { useTokenCostDisplaySettings } from "../hooks/useTokenCostDisplaySettings";
import { formatTokenPrice, TOKEN_PRICE_DISPLAY_PRECISION } from "../utils/tokenCost";

interface CustomTokenCostModalProps {
  open: boolean;
  providers: Provider[];
  t: Translate;
  onClose: () => void;
}

export function CustomTokenCostModal({ open, providers, t, onClose }: CustomTokenCostModalProps) {
  const display = useTokenCostDisplaySettings();
  const [referenceModel, setReferenceModel] = useState(loadTokenCostReferenceModel);
  const editor = useCustomTokenCostEditor({ open, providers, referenceModel });
  useEffect(() => {
    if (open) setReferenceModel(loadTokenCostReferenceModel());
  }, [open]);
  if (!open) return null;
  const changeReference = (model: string) => {
    saveTokenCostReferenceModel(model);
    setReferenceModel(model);
  };

  return createPortal(
    <div className="modal-backdrop custom-token-cost-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal custom-token-cost-modal" role="dialog" aria-modal="true"
        aria-labelledby="custom-token-cost-title">
        <button className="modal-close" onClick={onClose} aria-label={t("tokenCost.customBilling.close")}>
          <X size={17} />
        </button>
        <div className="custom-token-cost-header">
          <div className="modal-icon"><DollarSign size={22} /></div>
          <div>
            <h2 id="custom-token-cost-title">{t("tokenCost.customBilling.title")}</h2>
            <p>{t("tokenCost.customBilling.description")}</p>
          </div>
        </div>
        <div className="custom-token-cost-body">
          <TokenCostPresets referenceModel={referenceModel} onReferenceChange={changeReference} t={t} />
          <div className="custom-token-cost-custom">
            <div className="custom-token-cost-custom-header">
              <div className="custom-token-cost-section-heading">
                <h3>{t("tokenCost.customBilling.customTitle")}</h3>
                <small>{t("tokenCost.customBilling.customHint", { unit: display.unit })}</small>
              </div>
              <Button type="primary" disabled={!editor.valid} onClick={editor.save}>
                {t("tokenCost.customBilling.save")}
              </Button>
            </div>
            <div className="custom-token-cost-editor">
              <div className="custom-token-cost-field">
                <label htmlFor="custom-token-cost-api">{t("tokenCost.customBilling.api")}</label>
                <Select id="custom-token-cost-api" showSearch optionFilterProp="label"
                  value={editor.providerId || undefined} placeholder={t("tokenCost.customBilling.apiPlaceholder")}
                  classNames={{ popup: { root: "custom-token-cost-select-popup" } }} popupMatchSelectWidth={false}
                  options={editor.providerOptions} onChange={editor.selectProvider} />
              </div>
              <div className="custom-token-cost-field">
                <label htmlFor="custom-token-cost-model">{t("tokenCost.customBilling.model")}</label>
                <AutoComplete id="custom-token-cost-model" value={editor.model}
                  placeholder={t("tokenCost.customBilling.modelPlaceholder")}
                  classNames={{ popup: { root: "custom-token-cost-select-popup" } }} popupMatchSelectWidth={false}
                  options={editor.modelOptions} disabled={!editor.providerId}
                  filterOption={(input, option) => String(option?.value ?? "").toLowerCase()
                    .includes(input.toLowerCase())} onChange={editor.selectModel} />
              </div>
              <div className="custom-token-cost-rates">
                {(["input", "cachedInput", "output"] as const).map((rate) => <div
                  className="custom-token-cost-field" key={rate}>
                  <label htmlFor={`custom-token-cost-${rate}`}>{t(`tokenCost.customBilling.${rate}`)}</label>
                  <InputNumber id={`custom-token-cost-${rate}`} min={0} precision={TOKEN_PRICE_DISPLAY_PRECISION}
                    value={editor.rates[rate] == null ? null : editor.rates[rate] * display.usdMultiplier}
                    onChange={(value) => editor.setRate(rate, value == null ? null : value / display.usdMultiplier)}
                    disabled={!editor.providerId} />
                </div>)}
              </div>
              <small className="custom-token-cost-hint">
                {t(`tokenCost.customBilling.rateSource.${editor.rateSource}`, { model: referenceModel })}
                {!providers.length && <> {t("tokenCost.customBilling.noApis")}</>}
              </small>
            </div>
            <div className="custom-token-cost-saved">
              <strong>{t("tokenCost.customBilling.savedTitle")}</strong>
              {editor.rules.length ? editor.rules.map((rule) => {
                const provider = providers.find((item) => item.id === rule.providerId);
                return <div className="custom-token-cost-saved-row" key={`${rule.providerId}:${rule.model}`}>
                  <span><b>{provider?.name ?? rule.providerId}</b><code>{rule.model}</code></span>
                  <small>{[rule.input, rule.cachedInput, rule.output]
                    .map((price) => formatTokenPrice(price, display)).join(" / ")} {display.unit}</small>
                  <Button type="text" danger size="small" aria-label={t("tokenCost.customBilling.remove")}
                    icon={<Trash2 size={14} />} onClick={() => editor.remove(rule)} />
                </div>;
              }) : <small>{t("tokenCost.customBilling.empty")}</small>}
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
