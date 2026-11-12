import { ProviderActions } from './ProviderActions';
import { useState } from "react";
import { useTableScrollHeight } from '../../../hooks/useTableScrollHeight';
import type { Dispatch, SetStateAction } from "react";
import { Button, Checkbox, Dropdown, Popconfirm, Space, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, CircleOff, Columns3, ExternalLink, Pencil, Shuffle, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { hasMarketPage } from '../../../../../../shared/provider-market/pageLink';
import { marketText } from '../../../../../../shared/provider-market/i18n';
import { ProviderWebsiteIcon } from '../../../../../../shared/provider-market/ProviderWebsiteIcon';
import { providerWebsiteOrigin } from '../../../../../../shared/provider-market/providerWebsite';
import { remoteErrorText } from "../../../../../../shared/localization/errors";
import { ImageModelRouteSelect } from "../../../components/ImageModelRouteSelect";
import { TokenCostColumnTitle, useTokenCostDisplaySettings } from "../../../components/TokenCostUnitSettings";
import type { Language, Translate } from "../../../i18n";
import type {
  Account, ImageModelTarget, ImageRouteKind, Provider, ProviderTokenUsageTotals,
} from "../../../types";
import {
  apiFormatTag,
  ProviderBalanceCell,
  ProviderModelCell,
  ProviderModelControlCell,
  ProviderTokenCell,
  ProviderEstimatedCostCell,
} from "../ProviderCells";
import {
  isProviderTableColumnKey,
  loadHiddenColumns,
  persistHiddenColumns,
  type ProviderTableColumnKey,
} from "../providerUtils";
import {
  ProviderBulkGroupActions,
  ProviderGroupCell,
} from "../ProviderGroupControls";
import {
  type ProviderConnectivityErrors,
  type ProviderConnectivitySuccesses,
  useProviderConnectivity,
} from "../useProviderConnectivity";
import styles from "./index.module.less";
import type { TokenCostDisplaySettings } from "../../../utils/tokenCost";

interface ProviderViewProps {
  providers: Provider[];
  providerGroups: string[];
  accounts: Account[];
  busyProviderId: string | null;
  proxyRunning: boolean;
  fastModeEnabled: boolean;
  proxyBusy: boolean;
  proxyStartDisabledReason?: string;
  language: Language;
  usageForProvider: (provider: Provider) => ProviderTokenUsageTotals | undefined;
  onSwitch: (id: string) => void;
  onDeactivate: (id: string) => void;
  onStartProxy: () => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onGroupChange: (id: string, group: string) => void;
  onGroupChangeMany: (ids: string[], group: string) => Promise<string[]>;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (provider: Provider) => void;
  onOpenPage?: (provider: Provider) => void;
  imageInputTarget: ImageModelTarget | null;
  imageOutputTarget: ImageModelTarget | null;
  imageModelBusy: boolean;
  onImageModelChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  privacyMode: boolean;
  aggregateConversationCounts: Record<string, number>;
  t: Translate;
}

function ProviderProxyModeWarning({ options, cardView = false }: {
  options: Pick<ProviderViewProps,
    "onStartProxy" | "proxyBusy" | "proxyRunning" | "proxyStartDisabledReason" | "t">;
  cardView?: boolean;
}) {
  if (options.proxyRunning) return null;
  const button = (
    <Button danger size="small" loading={options.proxyBusy}
      disabled={Boolean(options.proxyStartDisabledReason)}>
      {options.t("providers.proxy.enable")}
    </Button>
  );
  const action = options.proxyStartDisabledReason ? (
    <Tooltip title={options.proxyStartDisabledReason}>
      <span className="provider-proxy-warning-action">{button}</span>
    </Tooltip>
  ) : (
    <Popconfirm title={options.t("providers.proxy.startConfirmTitle")}
      description={<span className="proxy-start-confirm-description">
        {options.t("providers.proxy.description")}
      </span>}
      okText={options.t("providers.proxy.start")} cancelText={options.t("providers.proxy.cancel")}
      disabled={options.proxyBusy} onConfirm={options.onStartProxy}>
      {button}
    </Popconfirm>
  );
  return (
    <div className={`provider-proxy-warning${cardView ? " card-view" : ""}`}>
      <span>{options.t("providers.proxy.requiredForSwitch")}</span>
      {action}
    </div>
  );
}

interface ProviderTableProps extends ProviderViewProps {
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  selectedProviderIds: string[];
  setSelectedProviderIds: Dispatch<SetStateAction<string[]>>;
  bulkDeleteBusy: boolean;
  setBulkDeleteBusy: Dispatch<SetStateAction<boolean>>;
}

function ProviderImageModelControls(options: ProviderViewProps) {
  return <div className="proxy-image-model-fields">
    <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="input"
      target={options.imageInputTarget} busy={options.imageModelBusy}
      onChange={options.onImageModelChange} privacyMode={options.privacyMode} t={options.t} />
    <ImageModelRouteSelect accounts={options.accounts} providers={options.providers} routeKind="output"
      target={options.imageOutputTarget} busy={options.imageModelBusy}
      onChange={options.onImageModelChange} privacyMode={options.privacyMode} t={options.t} />
  </div>;
}

function ProviderIdentityCell({ provider, error, successLatencyMs, conversationCount, onOpenPage, visitLabel, t }: {
  provider: Provider;
  error?: string;
  successLatencyMs?: number;
  conversationCount: number;
  onOpenPage?: (provider: Provider) => void;
  visitLabel: string;
  t: Translate;
}) {
  const providerBaseUrl = providerHomepageUrl(provider.baseUrl);
  return <div className="provider-cell">
    <ProviderAvatar provider={provider} conversationCount={conversationCount} iconSize={20} t={t} />
    <button type="button" className="provider-link" title={hasMarketPage(provider) ? visitLabel : t("providers.openBaseUrl")}
      onClick={() => hasMarketPage(provider) ? onOpenPage?.(provider) : void openUrl(providerBaseUrl)}>
      <span className="provider-link-name">
        <strong>{provider.name}</strong>
        {error && <Tooltip title={remoteErrorText(error)} styles={{ root: { maxWidth: 400 } }}>
          <span className="provider-connectivity-error">{t("providers.connectivity.error")}</span>
        </Tooltip>}
        {successLatencyMs !== undefined && (
          <span className="provider-connectivity-success">
            {t("providers.connectivity.success", { latency: successLatencyMs })}
          </span>
        )}
        <ExternalLink className="provider-external-link" size={12} />
      </span>
      <span className="provider-base-url" title={provider.baseUrl}>{provider.baseUrl}</span>
    </button>
  </div>;
}

function providerHomepageUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function ProviderAvatar({ provider, conversationCount, iconSize, t }: {
  provider: Provider;
  conversationCount: number;
  iconSize: number;
  t: Translate;
}) {
  const countLabel = t("table.conversationCount", { count: conversationCount });
  return <div className="table-avatar-wrap">
    <div className="provider-avatar"><ProviderWebsiteIcon url={providerWebsiteOrigin(provider)} size={iconSize} /></div>
    {conversationCount > 0 && <span className="account-conversation-count"
      title={countLabel} aria-label={countLabel}>
      {conversationCount > 99 ? "99+" : conversationCount}
    </span>}
  </div>;
}

function buildColumns(
  options: ProviderViewProps,
  connectivityErrors: ProviderConnectivityErrors,
  connectivitySuccesses: ProviderConnectivitySuccesses,
  tokenCostDisplay: TokenCostDisplaySettings,
): ColumnsType<Provider> {
  const { busyProviderId, language, usageForProvider, onSwitchModel, onModelControlChange, t } = options;
  return [
    {
      title: t("providers.table.provider"), key: "provider", dataIndex: "name", width: 240,
      render: (_, provider) => <ProviderIdentityCell provider={provider}
        onOpenPage={options.onOpenPage}
        visitLabel={marketText(language)('market.visitPage')}
        error={connectivityErrors[provider.id]}
        successLatencyMs={connectivitySuccesses[provider.id]}
        conversationCount={options.aggregateConversationCounts[provider.id] ?? 0} t={t} />,
    },
    {
      title: t("providers.table.group"), key: "group", dataIndex: "group", width: 150,
      render: (_, provider) => <ProviderGroupCell provider={provider} groups={options.providerGroups}
        busy={busyProviderId === provider.id} onChange={options.onGroupChange} t={t} />,
    },
    {
      title: t("providers.table.model"), key: "model", dataIndex: "model", width: 260,
      render: (_, provider) => <ProviderModelCell provider={provider}
        busy={busyProviderId === provider.id} onSwitchModel={onSwitchModel} t={t} />,
    },
    { title: t("providers.table.api"), key: "api", width: 120, render: (_, provider) => apiFormatTag(provider, t) },
    {
      title: t("providers.table.modelControl"), key: "modelControl", width: 190,
      render: (_, provider) => <ProviderModelControlCell provider={provider}
        busy={busyProviderId === provider.id} onModelControlChange={onModelControlChange} t={t} />,
    },
    {
      title: t("providers.table.balance"), key: "balance", width: 155,
      render: (_, provider) => <ProviderBalanceCell provider={provider} t={t} />,
    },
    {
      title: t("providers.table.todayTokens"), key: "todayTokens", width: 105, align: "center",
      render: (_, provider) => <ProviderTokenCell usage={usageForProvider(provider)}
        period="today" language={language} t={t} />,
    },
    {
      title: t("providers.table.totalTokens"), key: "totalTokens", width: 105, align: "center",
      render: (_, provider) => <ProviderTokenCell usage={usageForProvider(provider)}
        period="total" language={language} t={t} />,
    },
    {
      title: <TokenCostColumnTitle label={t("providers.table.estimatedCost")}
        settings={tokenCostDisplay} providers={options.providers} t={t} />,
      key: "estimatedCost", width: 145, align: "center",
      render: (_, provider) => <ProviderEstimatedCostCell usage={usageForProvider(provider)}
        settings={tokenCostDisplay} burning={options.fastModeEnabled} t={t} />,
    },
    {
      title: t("providers.table.actions"), key: "actions",
      width: options.providers.some(hasMarketPage) ? 395 : 285, align: "right", fixed: "right",
      render: (_, provider) => <ProviderActions provider={provider} options={options} />,
    },
  ];
}

export function ProviderTableView(options: ProviderTableProps) {
  const {
    providers,
    onDeleteMany,
    selectedProviderIds,
    setSelectedProviderIds,
    bulkDeleteBusy,
    setBulkDeleteBusy,
    t,
  } = options;
  const { tableWrapRef, tableScrollY } = useTableScrollHeight('.provider-table-toolbar');
  const [hiddenColumns, setHiddenColumns] = useState<ProviderTableColumnKey[]>(loadHiddenColumns);
  const tokenCostDisplay = useTokenCostDisplaySettings();
  const providerIds = providers.map((provider) => provider.id);
  const connectivity = useProviderConnectivity(providerIds);
  const columns = buildColumns(options, connectivity.errors, connectivity.successes, tokenCostDisplay);
  const hiddenColumnSet = new Set(hiddenColumns);
  const selectedProviderIdSet = new Set(selectedProviderIds);
  const selectedProviders = providers.filter((provider) => selectedProviderIdSet.has(provider.id));
  const visibleColumns = columns.filter((column) =>
    !isProviderTableColumnKey(column.key) || !hiddenColumnSet.has(column.key));
  const columnSettings: { key: ProviderTableColumnKey; label: string }[] = [
    { key: "provider", label: t("providers.table.provider") },
    { key: "group", label: t("providers.table.group") },
    { key: "model", label: t("providers.table.model") },
    { key: "api", label: t("providers.table.api") },
    { key: "modelControl", label: t("providers.table.modelControl") },
    { key: "balance", label: t("providers.table.balance") },
    { key: "todayTokens", label: t("providers.table.todayTokens") },
    { key: "totalTokens", label: t("providers.table.totalTokens") },
    { key: "estimatedCost", label: t("providers.table.estimatedCost") },
    { key: "actions", label: t("providers.table.actions") },
  ];
  const visibleColumnCount = columnSettings.filter(({ key }) => !hiddenColumnSet.has(key)).length;
  const tableScrollX = 36 + visibleColumns.reduce(
    (total, column) => total + (typeof column.width === "number" ? column.width : 0), 0,
  );
  const setColumnVisible = (key: ProviderTableColumnKey, visible: boolean) => setHiddenColumns((current) => {
    if (!visible && !current.includes(key) && visibleColumnCount <= 1) return current;
    const next = visible ? current.filter((column) => column !== key) : [...new Set([...current, key])];
    persistHiddenColumns(next);
    return next;
  });
  const deleteSelected = async () => {
    const ids = [...selectedProviderIds];
    setBulkDeleteBusy(true);
    try {
      const deletedIdSet = new Set(await onDeleteMany(ids));
      setSelectedProviderIds((current) => current.filter((id) => !deletedIdSet.has(id)));
    } finally {
      setBulkDeleteBusy(false);
    }
  };
  return <div ref={tableWrapRef} className={`${styles.styleScope} provider-table-wrap`}>
    <div className="provider-table-toolbar">
      <ProviderProxyModeWarning options={options} />
      {options.proxyRunning && (
        <ProviderImageModelControls {...options} />
      )}
      <ProviderBulkGroupActions groups={options.providerGroups} selectedProviders={selectedProviders}
        busy={Boolean(options.busyProviderId)} onChangeMany={options.onGroupChangeMany} t={t} />
      <Popconfirm title={t("providers.batchDelete.title", { count: selectedProviderIds.length })}
        description={t("providers.batchDelete.description")} okText={t("providers.delete.ok")}
        cancelText={t("providers.delete.cancel")} okButtonProps={{ danger: true }}
        disabled={!selectedProviderIds.length || bulkDeleteBusy} onConfirm={deleteSelected}>
        <Button danger size="small" icon={<Trash2 size={14} />} loading={bulkDeleteBusy}
          disabled={!selectedProviderIds.length}>
          {t("providers.batchDelete.action", { count: selectedProviderIds.length })}
        </Button>
      </Popconfirm>
      <Button size="small" icon={<Activity size={14} />} loading={connectivity.testing}
        disabled={!selectedProviderIds.length || connectivity.testing}
        onClick={() => void connectivity.testMany(selectedProviderIds)}>
        {t("providers.batchConnectivity.action", { count: selectedProviderIds.length })}
      </Button>
      <Dropdown trigger={["click"]} placement="bottomRight" dropdownRender={() => (
        <div className="provider-column-settings" onClick={(event) => event.stopPropagation()}>
          <strong>{t("table.columnSettings")}</strong>
          <div className="provider-column-settings-list">{columnSettings.map(({ key, label }) => {
            const checked = !hiddenColumnSet.has(key);
            return <Checkbox key={key} checked={checked} disabled={checked && visibleColumnCount <= 1}
              onChange={(event) => setColumnVisible(key, event.target.checked)}>{label}</Checkbox>;
          })}</div>
        </div>
      )}>
        <Tooltip title={t("table.columnSettings")}><Button size="small" className="table-icon-button"
          aria-label={t("table.columnSettings")} icon={<Columns3 size={15} />} /></Tooltip>
      </Dropdown>
    </div>
    <Table rowKey="id" size="small" columns={visibleColumns} dataSource={providers}
      rowSelection={{ fixed: true, columnWidth: 36, selectedRowKeys: selectedProviderIds,
        onChange: (keys) => setSelectedProviderIds(keys.map(String)) }}
      rowClassName={(provider) => [
        provider.active ? "active-row" : "",
        !options.proxyRunning ? "proxy-required-row" : "",
      ].filter(Boolean).join(" ")}
      pagination={false} scroll={{ x: tableScrollX, y: tableScrollY }} />
  </div>;
}

function ProviderCard({ provider, options, tokenCostDisplay }: {
  provider: Provider;
  options: ProviderViewProps;
  tokenCostDisplay: TokenCostDisplaySettings;
}) {
  const {
    busyProviderId,
    language,
    usageForProvider,
    onSwitch,
    onDeactivate,
    onSwitchModel,
    onModelControlChange,
    onAutoSwitchChange,
    onDelete,
    onEdit,
    t,
  } = options;
  const waiting = busyProviderId === provider.id;
  const aggregateConversationCount = options.aggregateConversationCounts[provider.id] ?? 0;
  const cardClassName = `provider-card${provider.active ? " active" : ""}`
    + `${options.proxyRunning ? "" : " proxy-required-card"}`
    + `${provider.supportsDirectSwitch ? " switchable" : ""}`;
  return <article className={cardClassName} onClick={(event) => {
    if ((event.target as HTMLElement).closest("button, input, select, .ant-select")) return;
    if (!provider.active && provider.supportsDirectSwitch) onSwitch(provider.id);
  }}>
    <div className="card-topline" />
    <header className="provider-card-head">
      <ProviderAvatar provider={provider} conversationCount={aggregateConversationCount} iconSize={22} t={t} />
      <div>{hasMarketPage(provider) ? <button className="provider-link" type="button"
        onClick={() => options.onOpenPage?.(provider)}><strong>{provider.name}</strong></button>
        : <strong>{provider.name}</strong>}<span title={provider.baseUrl}>{provider.baseUrl}</span></div>
      {provider.active
        ? <Tag className="current-tag">{t("providers.status.current")}</Tag>
        : provider.supportsDirectSwitch
          ? <Tag>{t("providers.status.ready")}</Tag>
          : <Tag color="gold">{t("providers.status.bridgeRequired")}</Tag>}
      <div className="provider-card-top-actions">
        {hasMarketPage(provider) && <Tooltip title={marketText(language)('market.visitPage')}>
          <Button size="small" aria-label={marketText(language)('market.visitPage')} icon={<ExternalLink size={14} />}
            onClick={() => options.onOpenPage?.(provider)} /></Tooltip>}
        {provider.active && (
          <Tooltip title={t("providers.action.cancelUse")}>
            <Button size="small" className="table-icon-button" loading={waiting}
              aria-label={t("providers.action.cancelUse")} icon={<CircleOff size={14} />}
              onClick={() => onDeactivate(provider.id)} />
          </Tooltip>
        )}
        {options.proxyRunning && provider.kind === "custom" && (
          <Tooltip title={t(provider.autoSwitchEnabled
            ? "providers.tooltip.autoSwitchEnabled"
            : "providers.tooltip.autoSwitch")}>
            <Button size="small" type={provider.autoSwitchEnabled ? "primary" : "default"}
              className="table-icon-button" loading={waiting}
              aria-label={t("providers.action.autoSwitch")} icon={<Shuffle size={14} />}
              onClick={() => onAutoSwitchChange(provider.id, !provider.autoSwitchEnabled)} />
          </Tooltip>
        )}
        <Popconfirm title={t("providers.delete.title")} description={t("providers.delete.description")}
          okText={t("providers.delete.ok")} cancelText={t("providers.delete.cancel")}
          okButtonProps={{ danger: true }} onConfirm={() => onDelete(provider.id)}>
          <Button danger size="small" className="table-icon-button"
            aria-label={t("providers.tooltip.delete")} loading={waiting} icon={<Trash2 size={14} />} />
        </Popconfirm>
        <Button size="small" className="table-icon-button" aria-label={t("providers.tooltip.edit")}
          icon={<Pencil size={14} />} onClick={() => onEdit(provider)} />
      </div>
    </header>
    <div className="provider-card-details">
      <div><span>{t("providers.table.model")}</span><ProviderModelCell provider={provider}
        busy={waiting} onSwitchModel={onSwitchModel} t={t} /></div>
      <div><span>{t("providers.table.group")}</span><ProviderGroupCell provider={provider}
        groups={options.providerGroups} busy={waiting} onChange={options.onGroupChange} t={t} /></div>
      <div><span>{t("providers.table.api")}</span>{apiFormatTag(provider, t)}</div>
      <div><span>{t("providers.table.modelControl")}</span><ProviderModelControlCell provider={provider}
        busy={waiting} onModelControlChange={onModelControlChange} t={t} /></div>
    </div>
    <div className="provider-card-summary">
      <div className="provider-card-summary-item"><ProviderBalanceCell provider={provider} t={t} /></div>
      <div className="provider-card-summary-item"><span>{t("providers.table.todayTokens")}</span><ProviderTokenCell
        usage={usageForProvider(provider)} period="today" language={language} t={t} /></div>
      <div className="provider-card-summary-item"><span>{t("providers.table.totalTokens")}</span><ProviderTokenCell
        usage={usageForProvider(provider)} period="total" language={language} t={t} /></div>
      <div className="provider-card-summary-item"><ProviderEstimatedCostCell
        usage={usageForProvider(provider)} settings={tokenCostDisplay} t={t} /></div>
    </div>
  </article>;
}

export function ProviderCardView(options: ProviderViewProps) {
  const tokenCostDisplay = useTokenCostDisplaySettings();
  return <>
    <ProviderProxyModeWarning options={options} cardView />
    {options.proxyRunning && (
      <div className="provider-card-image-model-toolbar">
        <ProviderImageModelControls {...options} />
      </div>
    )}
    <div className={`${styles.styleScope} provider-card-grid`}>
      {options.providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} options={options}
          tokenCostDisplay={tokenCostDisplay} />
      ))}
    </div>
  </>;
}
