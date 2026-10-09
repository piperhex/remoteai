import { useState } from "react";
import { Button, Input, InputNumber, Modal, Select } from "antd";
import { Settings2 } from "lucide-react";
import type { Translate } from "../i18n";
import type { Provider } from "../types";
import { CustomTokenCostModal } from "./CustomTokenCostModal";
import type { TokenCostDisplaySettings } from "../utils/tokenCost";
import { useTokenCostDisplayEditor } from "../hooks/useTokenCostDisplayEditor";
import { useTokenCostDisplaySettings } from "../hooks/useTokenCostDisplaySettings";
import styles from "./TokenCostUnitSettings.module.less";

export { useTokenCostDisplaySettings } from "../hooks/useTokenCostDisplaySettings";

interface SettingsProps {
  settings: TokenCostDisplaySettings;
  providers: Provider[];
  t: Translate;
}

function TokenCostSettingsDialog({ settings, t, onClose, onCustomBilling }: {
  settings: TokenCostDisplaySettings; t: Translate; onClose: () => void; onCustomBilling: () => void;
}) {
  const editor = useTokenCostDisplayEditor(settings);
  const save = () => {
    if (editor.save()) onClose();
  };
  return <Modal open centered title={t("tokenCost.settings.title")} width={400}
    styles={{ body: { maxHeight: "calc(100dvh - 180px)", overflowY: "auto" } }}
    onCancel={onClose} onOk={save} okButtonProps={{ disabled: !editor.valid }}
    okText={t("tokenCost.settings.save")} cancelText={t("tokenCost.settings.cancel")}>
    <div className={styles.form}>
      <p>{t("tokenCost.settings.description")}</p>
      <label htmlFor="token-cost-currency">{t("tokenCost.settings.currency")}</label>
      <Select id="token-cost-currency" allowClear loading={editor.loading}
        placeholder={t("tokenCost.settings.currencyPlaceholder")}
        options={editor.currencies.map((currency) => ({
          value: currency.code, label: `${currency.name} (${currency.code})`,
        }))} value={editor.currencyCode ?? undefined} onChange={editor.selectCurrency} />
      <label htmlFor="token-cost-unit">{t("tokenCost.settings.unit")}</label>
      <Input id="token-cost-unit" value={editor.unit} maxLength={12}
        onChange={(event) => editor.changeUnit(event.target.value)} />
      <label htmlFor="token-cost-multiplier">{t("tokenCost.settings.usdMultiplier")}</label>
      <InputNumber id="token-cost-multiplier" min={0.000001} precision={6}
        value={editor.usdMultiplier} disabled={Boolean(editor.currencyCode)} onChange={editor.setUsdMultiplier} />
      <small>{t("tokenCost.settings.hint", { unit: editor.unit.trim() || settings.unit })}</small>
      <Button disabled={!editor.valid} onClick={() => { save(); onCustomBilling(); }}>
        {t("tokenCost.settings.customBilling")}
      </Button>
    </div>
  </Modal>;
}

export function TokenCostSettingsButton({ settings, providers, t, compact = false }: SettingsProps & {
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customBillingOpen, setCustomBillingOpen] = useState(false);
  return <>
    <Button type={compact ? "text" : "default"} size={compact ? "small" : "middle"}
      className={compact ? "token-cost-settings-button" : undefined}
      aria-label={t("tokenCost.settings.title")} icon={<Settings2 size={compact ? 13 : 15} />}
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      {compact ? null : t("tokenCost.settings.configure")}
    </Button>
    {open && <TokenCostSettingsDialog settings={settings} t={t} onClose={() => setOpen(false)}
      onCustomBilling={() => setCustomBillingOpen(true)} />}
    <CustomTokenCostModal open={customBillingOpen} providers={providers} t={t}
      onClose={() => setCustomBillingOpen(false)} />
  </>;
}

export function TokenCostColumnTitle({ label, ...props }: SettingsProps & { label: string }) {
  return <span className="token-cost-column-title">
    <span>{label}</span><TokenCostSettingsButton {...props} compact />
  </span>;
}

export function TokenCostSettingsCard({ providers, t }: Pick<SettingsProps, "providers" | "t">) {
  const settings = useTokenCostDisplaySettings();
  return <section className={`settings-card ${styles.card}`}>
    <div className="settings-icon"><Settings2 size={23} /></div>
    <div className="settings-card-content">
      <div className="settings-card-copy">
        <h3>{t("tokenCost.settings.title")}</h3><p>{t("tokenCost.settings.description")}</p>
      </div>
      <TokenCostSettingsButton settings={settings} providers={providers} t={t} />
    </div>
  </section>;
}
