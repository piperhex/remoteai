import { Button, Popconfirm, Popover, Switch, Tag, Tooltip } from "antd";
import { Cable, ChevronDown, Power, PowerOff, RadioTower, Shuffle } from "lucide-react";
import type { Translate } from "../i18n";
import type {
  Account, ImageModelTarget, ImageRouteKind, LocalProxyStatus, Provider,
} from "../types";
import { ImageModelRouteSelect } from "./ImageModelRouteSelect";

interface LocalProxyCardProps {
  localProxy: LocalProxyStatus | null;
  accounts: Account[];
  providers: Provider[];
  proxyBusy: boolean;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onOpenSessions: () => void;
  onAutoSwitchChange: (enabled: boolean) => void;
  onCustomAutoSwitchPriorityEnabledChange: (enabled: boolean) => void;
  onCustomAutoSwitchThresholdEnabledChange: (enabled: boolean) => void;
  onAutoDisableUnreachableChange: (enabled: boolean) => void;
  onImageModelChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  onListenOnAllInterfacesChange: (enabled: boolean) => void;
  startDisabledReason?: string;
  t: Translate;
}

export function LocalProxyCard({
  localProxy,
  accounts,
  providers,
  proxyBusy,
  onStartProxy,
  onStopProxy,
  onOpenSessions,
  onAutoSwitchChange,
  onCustomAutoSwitchPriorityEnabledChange,
  onCustomAutoSwitchThresholdEnabledChange,
  onAutoDisableUnreachableChange,
  onImageModelChange,
  onListenOnAllInterfacesChange,
  startDisabledReason,
  t,
}: LocalProxyCardProps) {
  const proxyRunning = Boolean(localProxy?.running);
  const activeAccount = accounts.find(account => account.active && account.accountSource !== 'claudeCode');
  const showImageModelSelectors = proxyRunning && (
    Boolean(activeAccount?.agentIdentity)
    || Boolean(localProxy?.concurrentAccountRoutingEnabled)
  );
  const proxyBaseUrl = localProxy
    ? `http://${localProxy.address}:${localProxy.port}/v1`
    : "http://127.0.0.1:15722/v1";
  const actionButton = (
    <Button size="small" type="primary" danger={proxyRunning} loading={proxyBusy}
      disabled={!proxyRunning && Boolean(startDisabledReason)}
      icon={proxyRunning ? <PowerOff size={14} /> : <Power size={14} />}
      onClick={proxyRunning ? onStopProxy : undefined}>
      {proxyRunning ? t("providers.proxy.stop") : t("providers.proxy.start")}
    </Button>
  );

  return (
    <section className={`provider-proxy${proxyRunning ? " active" : ""}`}>
      <div className="provider-official-main">
        <div className="provider-avatar proxy"><RadioTower size={16} /></div>
        <div className="provider-proxy-copy">
          <strong>{t("providers.proxy.title")}</strong>
          <span title={proxyBaseUrl}>{t("providers.proxy.baseUrl", { url: proxyBaseUrl })}</span>
        </div>
      </div>
      <div className="provider-official-actions">
        {showImageModelSelectors && (
          <div className="proxy-image-model-fields">
            <ImageModelRouteSelect accounts={accounts} providers={providers} routeKind="input"
              target={localProxy?.imageInputTarget} busy={proxyBusy}
              onChange={onImageModelChange} t={t} />
            <ImageModelRouteSelect accounts={accounts} providers={providers} routeKind="output"
              target={localProxy?.imageOutputTarget} busy={proxyBusy}
              onChange={onImageModelChange} t={t} />
          </div>
        )}
        <Tag className={proxyRunning ? "current-tag" : undefined}>
          {proxyRunning ? t("providers.proxy.running") : t("providers.proxy.stopped")}
        </Tag>
        {proxyRunning ? actionButton : startDisabledReason ? (
          <Tooltip title={startDisabledReason}><span>{actionButton}</span></Tooltip>
        ) : (
          <Popconfirm title={t("providers.proxy.startConfirmTitle")}
            description={(
              <span className="proxy-start-confirm-description">
                {t("providers.proxy.description")}
              </span>
            )}
            okText={t("providers.proxy.start")} cancelText={t("providers.proxy.cancel")}
            disabled={proxyBusy} onConfirm={onStartProxy}>
            {actionButton}
          </Popconfirm>
        )}
        {proxyRunning && <Button size="small" icon={<Cable size={14} />} onClick={onOpenSessions}>
          {t("providers.proxy.sessions")}
        </Button>}
        {proxyRunning && (
          <>
            <Popover trigger="hover" placement="bottom" mouseEnterDelay={0.08} mouseLeaveDelay={0.12}
              content={(
                <div className="proxy-auto-switch-menu">
                  <div className="proxy-auto-switch-menu-item"
                    title={t("providers.proxy.autoSwitchTooltip")}>
                    <span>{t("providers.proxy.autoSwitch")}</span>
                    <Switch size="small" checked={localProxy?.autoSwitchOnQuotaExhaustion ?? false}
                      disabled={proxyBusy} onChange={onAutoSwitchChange} />
                  </div>
                  <Tooltip title={t("table.customPriorityTooltip")} styles={{ root: { maxWidth: 400 } }}>
                    <div className="proxy-auto-switch-menu-item">
                      <span>{t("table.customPriorityEnabled")}</span>
                      <Switch size="small" checked={localProxy?.customAutoSwitchPriorityEnabled ?? false}
                        disabled={proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                        onChange={onCustomAutoSwitchPriorityEnabledChange} />
                    </div>
                  </Tooltip>
                  <div className="proxy-auto-switch-menu-item"
                    title={t("table.customThresholdTooltip")}>
                    <span>{t("table.customThresholdEnabled")}</span>
                    <Switch size="small" checked={localProxy?.customAutoSwitchThresholdEnabled ?? false}
                      disabled={proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                      onChange={onCustomAutoSwitchThresholdEnabledChange} />
                  </div>
                  <div className="proxy-auto-switch-menu-item"
                    title={t("providers.proxy.autoDisableUnreachableTooltip")}>
                    <span>{t("providers.proxy.autoDisableUnreachable")}</span>
                    <Switch size="small" checked={localProxy?.autoDisableUnreachableAccounts ?? false}
                      disabled={proxyBusy || !localProxy?.autoSwitchOnQuotaExhaustion}
                      onChange={onAutoDisableUnreachableChange} />
                  </div>
                </div>
              )}>
              <button type="button"
                className={`proxy-auto-switch-entry${localProxy?.autoSwitchOnQuotaExhaustion ? " active" : ""}`}
                aria-label={t("providers.proxy.autoSwitch")}>
                <Shuffle size={14} />
                <span>{t("providers.proxy.autoSwitch")}</span>
                <ChevronDown size={12} />
              </button>
            </Popover>
            <Tooltip title={t("providers.proxy.listenAllInterfacesTooltip")}>
              <span className="proxy-auto-switch">
                <Switch size="small" checked={localProxy?.listenOnAllInterfaces ?? false}
                  disabled={proxyBusy} onChange={onListenOnAllInterfacesChange} />
                <span>{t("providers.proxy.listenAllInterfaces")}</span>
              </span>
            </Tooltip>
          </>
        )}
      </div>
    </section>
  );
}
