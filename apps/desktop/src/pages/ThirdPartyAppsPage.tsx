import { useEffect, useState } from "react";
import { useViewActive } from '../../../../shared/RetainedView';
import { createPortal } from "react-dom";
import { Button, Card, Modal, Select, Space, Switch, Typography } from "antd";
import { Play, RefreshCw, SquareTerminal } from "lucide-react";
import { ThirdPartyAppsSetupNotice } from "./ThirdPartyAppsSetupNotice";
import type { Translate, TranslationKey } from "../i18n";
import type {
  ClaudeSubagentModel,
  ThirdPartyAppId,
  ThirdPartyAppWriteSettings,
} from "../types";

const THIRD_PARTY_APPS: ReadonlyArray<{
  id: ThirdPartyAppId;
  labelKey: TranslationKey;
}> = [
  { id: "claudeCode", labelKey: "thirdPartyApps.app.claudeCode" },
  { id: "openCode", labelKey: "thirdPartyApps.app.openCode" },
  { id: "openClaw", labelKey: "thirdPartyApps.app.openClaw" },
  { id: "hermesAgent", labelKey: "thirdPartyApps.app.hermesAgent" },
  { id: "workBuddy", labelKey: "thirdPartyApps.app.workBuddy" },
  { id: "zCode", labelKey: "thirdPartyApps.app.zCode" },
  { id: "deepSeekHarness", labelKey: "thirdPartyApps.app.deepSeekHarness" },
  { id: "openViking", labelKey: "thirdPartyApps.app.openViking" },
];

interface ThirdPartyAppsPageProps {
  settings: ThirdPartyAppWriteSettings;
  saving: boolean;
  proxyBusy: boolean;
  proxyRunning: boolean;
  proxyStartDisabledReason?: string;
  hasProxyTarget: boolean;
  busy: "launch" | "restart" | null;
  onEnabledChange: (enabled: boolean) => void;
  onWriteCodexChange: (enabled: boolean) => void;
  onStartProxy: () => void;
  onOpenAccounts: () => void;
  onOpenProviders: () => void;
  notify: (message: string) => void;
  onAppChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onSubagentModelChange: (model: ClaudeSubagentModel) => void;
  subagentModels: string[];
  subagentModel: ClaudeSubagentModel;
  onLaunch: (appId: LaunchableThirdPartyApp) => void;
  onRestart: (appId: LaunchableThirdPartyApp) => void;
  t: Translate;
}

type LaunchableThirdPartyApp = "claudeCode" | "openCode";

function isLaunchableThirdPartyApp(appId: ThirdPartyAppId): appId is LaunchableThirdPartyApp {
  return appId === "claudeCode" || appId === "openCode";
}

function subagentModelLabel(model: string) {
  const officialLabels: Record<string, string> = {
    sol: "GPT-5.6 Sol",
    terra: "GPT-5.6 Terra",
    luna: "GPT-5.6 Luna",
  };
  return officialLabels[model] ?? model;
}

interface AppRowProps {
  appId: ThirdPartyAppId;
  label: string;
  checked: boolean;
  disabled: boolean;
  busy: ThirdPartyAppsPageProps["busy"];
  subagentModel: ClaudeSubagentModel;
  subagentModels: string[];
  onChange: (appId: ThirdPartyAppId, enabled: boolean) => void;
  onSubagentModelChange: (model: ClaudeSubagentModel) => void;
  onLaunch: (appId: LaunchableThirdPartyApp) => void;
  onRestart: (appId: LaunchableThirdPartyApp) => void;
  t: Translate;
}

function AppRow(props: AppRowProps) {
  const {
    appId, label, checked, disabled, busy, subagentModel, subagentModels,
    onChange, onSubagentModelChange, onLaunch, onRestart, t,
  } = props;
  const hasProcessControls = isLaunchableThirdPartyApp(appId);
  const launchLabel = appId === "claudeCode" ? t("claudeCode.launch") : t("openCode.launch");
  const restartLabel = appId === "claudeCode" ? t("claudeCode.restart") : t("openCode.restart");
  return (
    <div className="third-party-app-row" role="listitem">
      <div className="third-party-app-identity">
        <span className="third-party-app-icon"><SquareTerminal size={18} /></span>
        <Typography.Text strong>{label}</Typography.Text>
      </div>
      <div className="third-party-app-row-actions">
        {hasProcessControls && (
          <Space wrap size={8}>
            <Typography.Text type="secondary">{t("thirdPartyApps.subagentModel")}</Typography.Text>
            <Select<ClaudeSubagentModel>
              value={subagentModel}
              disabled={disabled}
              onChange={onSubagentModelChange}
              options={subagentModels.map((model) => ({ value: model, label: subagentModelLabel(model) }))}
              style={{ width: 150 }}
            />
            <Button size="small" icon={<Play size={14} />} loading={busy === "launch"}
              onClick={() => onLaunch(appId)}>
              {launchLabel}
            </Button>
            <Button size="small" icon={<RefreshCw size={14} />} loading={busy === "restart"}
              onClick={() => onRestart(appId)}>
              {restartLabel}
            </Button>
          </Space>
        )}
        <Switch
          checked={checked}
          disabled={disabled}
          aria-label={t("thirdPartyApps.appWriteAria", { app: label })}
          onChange={(enabled) => onChange(appId, enabled)}
        />
      </div>
    </div>
  );
}

export function ThirdPartyAppsPage(props: ThirdPartyAppsPageProps) {
  const active = useViewActive();
  const {
    settings, saving, proxyBusy, proxyRunning, proxyStartDisabledReason, hasProxyTarget, busy,
    onEnabledChange, onWriteCodexChange, onStartProxy, onOpenAccounts, onOpenProviders,
    onAppChange, onSubagentModelChange, onLaunch, onRestart, notify, t,
    subagentModels, subagentModel,
  } = props;
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);

  const handleEnabledChange = (enabled: boolean) => {
    if (!proxyRunning) {
      notify(t("thirdPartyApps.proxyRequired"));
      return;
    }
    if (enabled && !hasProxyTarget) {
      Modal.warning({
        title: t("thirdPartyApps.targetRequiredTitle"),
        content: t("thirdPartyApps.targetRequired"),
      });
      return;
    }
    onEnabledChange(enabled);
  };

  useEffect(() => {
    setTopbarHost(active ? document.getElementById("third-party-apps-topbar-actions") : null);
  }, [active]);

  return (
    <>
      {topbarHost && createPortal(
        <div className="third-party-apps-topbar-controls">
          <label className="third-party-apps-topbar-control">
            <Typography.Text strong>{t("thirdPartyApps.masterWrite")}</Typography.Text>
            <Switch checked={settings.enabled} loading={saving}
              disabled={saving} onChange={handleEnabledChange}
              aria-label={t("thirdPartyApps.masterWrite")} />
          </label>
          <label className="third-party-apps-topbar-control">
            <Typography.Text strong>{t("thirdPartyApps.writeCodex")}</Typography.Text>
            <Switch checked={settings.writeCodex} disabled={saving} onChange={onWriteCodexChange}
              aria-label={t("thirdPartyApps.writeCodex")} />
          </label>
        </div>,
        topbarHost,
      )}
      <div className="third-party-apps-page">
        <ThirdPartyAppsSetupNotice
          proxyRunning={proxyRunning} hasProxyTarget={hasProxyTarget} proxyBusy={proxyBusy}
          proxyStartDisabledReason={proxyStartDisabledReason} onStartProxy={onStartProxy}
          onOpenAccounts={onOpenAccounts} onOpenProviders={onOpenProviders} t={t}
        />
        <Card className="third-party-apps-card">
          <div className="third-party-apps-list-heading">
            <Typography.Text strong>{t("thirdPartyApps.listTitle")}</Typography.Text>
            <Typography.Text type="secondary">{t("thirdPartyApps.listHint")}</Typography.Text>
          </div>
          <div className="third-party-apps-list" role="list">
            {THIRD_PARTY_APPS.map(({ id, labelKey }) => (
              <AppRow key={id} appId={id} label={t(labelKey)} checked={settings.apps[id]}
                disabled={!settings.enabled || saving} busy={busy}
                subagentModel={subagentModel} onChange={onAppChange}
                subagentModels={subagentModels}
                onSubagentModelChange={onSubagentModelChange}
                onLaunch={onLaunch} onRestart={onRestart} t={t} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
