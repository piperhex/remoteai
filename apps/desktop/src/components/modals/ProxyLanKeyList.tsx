import { useEffect, useState } from "react";
import { Button, Popconfirm, Switch } from "antd";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import type { useLocalProxyLanKeys } from "../../hooks/useLocalProxyLanKeys";
import type { Translate, TranslationKey } from "../../i18n";
import type { LocalProxyLanApiKey } from "../../types";
import { needsUsageReview, unconfirmedRequests, usageReviewThreshold } from "../../api/localProxyLanUsage";
import { ProxyLanKeyEditor } from "./ProxyLanKeyEditor";
import "./ProxyLanKeyList.css";
import { useTokenCostDisplaySettings } from "../../hooks/useTokenCostDisplaySettings";
import { formatEstimatedCost } from "../../utils/tokenCost";

type KeyManager = ReturnType<typeof useLocalProxyLanKeys>;
interface ProxyLanKeyListProps {
  open: boolean;
  manager: KeyManager;
  disabled: boolean;
  listenOnAllInterfaces: boolean;
  t: Translate;
}

function KeyUsage({ entry, t }: { entry: LocalProxyLanApiKey; t: Translate }) {
  const settings = useTokenCostDisplaySettings();
  const formatCost = (value: number | null) => value === null ? t("providers.proxy.lanKeyUnlimited")
    : formatEstimatedCost(value, settings);
  return <dl className="proxy-lan-key-usage">
    <div><dt>{t("providers.proxy.lanKeyQuota", { unit: settings.unit })}</dt><dd>{formatCost(entry.quotaUsd)}</dd></div>
    <div><dt>{t("providers.proxy.lanKeyRemaining", { unit: settings.unit })}</dt><dd>{formatCost(entry.remainingUsd)}</dd></div>
    <div><dt>{t("providers.proxy.lanKeyUsedTokens")}</dt><dd>{entry.usedTokens.toLocaleString()}</dd></div>
    <div><dt>{t("providers.proxy.lanKeyUsedCost", { unit: settings.unit })}</dt><dd>{formatCost(entry.usedCostUsd)}</dd></div>
    <div><dt>{t("providers.proxy.lanKeyUnconfirmedRequests")}</dt>
      <dd>{unconfirmedRequests(entry).toLocaleString()} / {usageReviewThreshold(entry).toLocaleString()}</dd></div>
  </dl>;
}

interface KeyRowProps {
  entry: LocalProxyLanApiKey;
  actions: { manager: KeyManager; onEdit: () => void };
  state: { disabled: boolean; keepEnabled: boolean };
  t: Translate;
}

function KeyRow({ entry, actions, state, t }: KeyRowProps) {
  const { manager, onEdit } = actions;
  const { disabled, keepEnabled } = state;
  const label = (key: TranslationKey) => `${t(key)}: ${entry.name}`;
  return <li className="proxy-lan-key-row">
    <div className="proxy-settings-section-heading">
      <div className="proxy-lan-key-identity"><strong>{entry.name}</strong><code>{entry.keyPreview}</code></div>
      <Switch size="small" checked={entry.enabled} disabled={disabled || keepEnabled}
        aria-label={label("providers.proxy.lanKeyEnabled")}
        onChange={(enabled) => void manager.save({
          id: entry.id, name: entry.name, quotaUsd: entry.quotaUsd, enabled,
        })} />
    </div>
    <KeyUsage entry={entry} t={t} />
    {unconfirmedRequests(entry) > 0 && <p className={needsUsageReview(entry) ? "proxy-lan-key-error" : undefined}>
      {t(needsUsageReview(entry) ? "providers.proxy.lanKeyUsageReviewRequired"
        : "providers.proxy.lanKeyUsageIncomplete")}
    </p>}
    <div className="proxy-settings-key-actions">
      <Button size="small" icon={<Copy size={13} />} disabled={disabled}
        aria-label={label("providers.proxy.copyLanApiKey")} onClick={() => void manager.copy(entry.id)}>
        {t("providers.proxy.copyApiKey")}
      </Button>
      <Button size="small" icon={<Pencil size={13} />} disabled={disabled}
        aria-label={label("providers.proxy.lanKeyEdit")} onClick={onEdit}>{t("providers.proxy.lanKeyEdit")}</Button>
      <Popconfirm title={t("providers.proxy.lanKeyDeleteTitle")} description={t("providers.proxy.lanKeyDeleteHint")}
        overlayClassName="proxy-lan-key-confirm" okText={t("providers.proxy.lanKeyDelete")}
        cancelText={t("providers.proxy.cancel")} disabled={disabled || keepEnabled}
        onConfirm={() => void manager.remove(entry.id)}>
        <Button size="small" danger icon={<Trash2 size={13} />} disabled={disabled || keepEnabled}
          aria-label={label("providers.proxy.lanKeyDelete")}>{t("providers.proxy.lanKeyDelete")}</Button>
      </Popconfirm>
    </div>
    {keepEnabled && <p>{t("providers.proxy.lanKeyKeepEnabled")}</p>}
  </li>;
}

export function ProxyLanKeyList({ open, manager, disabled, listenOnAllInterfaces, t }: ProxyLanKeyListProps) {
  const [editing, setEditing] = useState<LocalProxyLanApiKey | "new" | null>(null);
  const busy = disabled || manager.saving;
  const keys = manager.keys ?? [];
  const enabledCount = keys.filter((key) => key.enabled).length;
  useEffect(() => { if (!open) setEditing(null); }, [open]);

  return <section className="proxy-settings-section" aria-labelledby="proxy-api-key-title">
    <div className="proxy-settings-section-heading">
      <h3 id="proxy-api-key-title">{t("providers.proxy.lanKeysTitle")}</h3>
      <Button size="small" icon={<Plus size={14} />} disabled={busy || editing !== null}
        onClick={() => setEditing("new")}>{t("providers.proxy.lanKeyAdd")}</Button>
    </div>
    <p>{t("providers.proxy.lanKeysDescription")}</p>
    {manager.failed && <p role="alert" className="proxy-lan-key-error">{t("providers.proxy.lanKeysLoadFailed")}</p>}
    {!manager.keys && !manager.failed && <p role="status">{t("providers.proxy.lanKeysLoading")}</p>}
    {manager.keys?.length === 0 && !editing && <p>{t("providers.proxy.lanKeysEmpty")}</p>}
    <ul className="proxy-lan-key-list">{keys.map((entry) => <KeyRow key={entry.id} entry={entry} t={t}
      actions={{ manager, onEdit: () => setEditing(entry) }}
      state={{ disabled: busy || editing !== null,
        keepEnabled: listenOnAllInterfaces && entry.enabled && enabledCount === 1 }} />)}</ul>
    {editing !== null && <ProxyLanKeyEditor key={editing === "new" ? "new" : editing.id}
      entry={editing === "new" ? null : editing} disabled={busy}
      onSave={manager.save} onCancel={() => setEditing(null)} t={t} />}
  </section>;
}
