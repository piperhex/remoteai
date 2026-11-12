import { Button, Popconfirm, Space, Tooltip } from 'antd';
import { CircleOff, ExternalLink, Pencil, RotateCcw, Shuffle, Trash2 } from 'lucide-react';
import type { Provider } from '../../../types';
import type { Language, Translate } from '../../../i18n';
import { hasMarketPage } from '../../../../../../shared/provider-market/pageLink';
import { marketText } from '../../../../../../shared/provider-market/i18n';

export function ProviderActions({ provider, options }: {
  provider: Provider;
  options: {
    busyProviderId: string | null; proxyRunning: boolean; language: Language; t: Translate;
    onAutoSwitchChange: (id: string, enabled: boolean) => void;
    onSwitch: (id: string) => void; onDeactivate: (id: string) => void;
    onEdit: (provider: Provider) => void; onDelete: (id: string) => void;
    onOpenPage?: (provider: Provider) => void;
  };
}) {
  const {
    busyProviderId,
    proxyRunning,
    onAutoSwitchChange,
    onSwitch,
    onDeactivate,
    onEdit,
    onDelete,
    t,
  } = options;
  const waiting = busyProviderId === provider.id;
  return (
    <Space size={4} className="table-actions">
      {hasMarketPage(provider) && <Button size="small" icon={<ExternalLink size={14} />}
        onClick={() => options.onOpenPage?.(provider)}>{marketText(options.language)('market.visitPage')}</Button>}
      <Tooltip title={provider.active
        ? t("providers.action.cancelUse")
        : provider.supportsDirectSwitch
          ? t("providers.tooltip.switch")
          : t("providers.tooltip.requiresBridge")}>
        <Button size="small" type={provider.active ? "default" : "primary"}
          disabled={!provider.active && !provider.supportsDirectSwitch}
          loading={waiting} icon={provider.active ? <CircleOff size={14} /> : <RotateCcw size={14} />}
          onClick={() => provider.active ? onDeactivate(provider.id) : onSwitch(provider.id)}>
          {provider.active
            ? t("providers.action.cancelUse")
            : t("providers.action.switch")}
        </Button>
      </Tooltip>
      {proxyRunning && provider.kind === "custom" && (
        <Tooltip title={t(provider.autoSwitchEnabled
          ? "providers.tooltip.autoSwitchEnabled"
          : "providers.tooltip.autoSwitch")}>
          <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
            loading={waiting} icon={<Shuffle size={14} />}
            onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)}>
            {t("providers.action.autoSwitch")}
          </Button>
        </Tooltip>
      )}
      <Button size="small" className="table-icon-button" icon={<Pencil size={14} />}
        aria-label={t("providers.tooltip.edit")} onClick={() => onEdit(provider)} />
      <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
        okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")}
        okButtonProps={{ danger: true }} onConfirm={() => onDelete(provider.id)}>
        <Button danger size="small" className="table-icon-button" loading={waiting}
          aria-label={t("providers.tooltip.delete")} icon={<Trash2 size={14} />} />
      </Popconfirm>
    </Space>
  );
}
