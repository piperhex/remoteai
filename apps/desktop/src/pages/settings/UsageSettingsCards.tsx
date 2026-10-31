import { useMemo } from "react";
import { Button, Checkbox, InputNumber, Select, Space, Switch } from "antd";
import { CalendarDays, Gauge, Network, ShieldCheck, TimerReset } from "lucide-react";
import {
  MAX_TOKEN_USAGE_REFRESH_SECONDS,
  MAX_TOKEN_USAGE_WEEKS,
  MIN_TOKEN_USAGE_REFRESH_SECONDS,
  MIN_TOKEN_USAGE_WEEKS,
} from "../../hooks/useTokenUsagePreferences";
import { httpStatusOptions } from "@remoteai/i18n/copy/desktop/httpStatusOptions";
import { SseIdleTimeoutCard } from "./SseIdleTimeoutCard";
import { ProxyTransportCard } from "./ProxyTransportCard";
import { ResponseHeaderTimeoutCard } from "./ResponseHeaderTimeoutCard";
import { DurationTimePicker } from "./DurationTimePicker";
import type { SettingsPageProps } from "./types";
import { PetDockSettingsCard } from "./PetDockSettingsCard";
import { QuotaWindowSyncCard } from "./QuotaWindowSyncCard";

function TokenUsageCard({ settings }: { settings: SettingsPageProps }) {
  const {
    onTokenUsageRefreshSecondsChange,
    onTokenUsageWeeksChange,
    t,
    tokenUsagePreferencesLoading,
    tokenUsageRefreshSeconds,
    tokenUsageWeeks,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><CalendarDays size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.tokenUsage.title")}</h3><p>{t("settings.tokenUsage.description")}</p>
        </div>
        <div className="settings-field token-usage-settings-field">
          <label htmlFor="token-usage-weeks">{t("settings.tokenUsage.weeks")}</label>
          <Space.Compact>
            <InputNumber
              id="token-usage-weeks"
              min={MIN_TOKEN_USAGE_WEEKS}
              max={MAX_TOKEN_USAGE_WEEKS}
              step={1}
              value={tokenUsageWeeks}
              disabled={tokenUsagePreferencesLoading}
              onChange={onTokenUsageWeeksChange}
            />
            <Button disabled>{t("settings.tokenUsage.weeksUnit")}</Button>
          </Space.Compact>
          <label htmlFor="token-usage-refresh-interval">
            {t("settings.tokenUsage.refreshInterval")}
          </label>
          <Space.Compact>
            <InputNumber
              id="token-usage-refresh-interval"
              min={MIN_TOKEN_USAGE_REFRESH_SECONDS}
              max={MAX_TOKEN_USAGE_REFRESH_SECONDS}
              step={1}
              value={tokenUsageRefreshSeconds}
              disabled={tokenUsagePreferencesLoading}
              onChange={onTokenUsageRefreshSecondsChange}
            />
            <Button disabled>{t("settings.autoRefresh.seconds")}</Button>
          </Space.Compact>
        </div>
      </div>
    </section>
  );
}

function CodexUsageSummaryCard({ settings }: { settings: SettingsPageProps }) {
  const {
    codexUsageSummaryEnabled,
    onCodexUsageSummaryEnabledChange,
    t,
    tokenUsagePreferencesLoading,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Gauge size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.codexUsageSummary.title")}</h3>
          <p>{t("settings.codexUsageSummary.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="codex-usage-summary">{t("settings.codexUsageSummary.enabled")}</label>
          <Switch
            id="codex-usage-summary"
            checked={codexUsageSummaryEnabled}
            loading={tokenUsagePreferencesLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onCodexUsageSummaryEnabledChange}
          />
        </div>
      </div>
    </section>
  );
}

function UsageNetworkErrorsCard({ settings }: { settings: SettingsPageProps }) {
  const {
    onShowUsageNetworkErrorsChange,
    showUsageNetworkErrors,
    showUsageNetworkErrorsLoading,
    t,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Network size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.usageNetworkErrors.title")}</h3>
          <p>{t("settings.usageNetworkErrors.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="show-usage-network-errors">
            {t("settings.usageNetworkErrors.label")}
          </label>
          <Switch
            id="show-usage-network-errors"
            checked={showUsageNetworkErrors}
            loading={showUsageNetworkErrorsLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={(enabled) => void onShowUsageNetworkErrorsChange(enabled)}
          />
        </div>
      </div>
    </section>
  );
}

function Upstream429RetryCard({ settings }: { settings: SettingsPageProps }) {
  const {
    onUpstream429RetryTimeoutChange,
    t,
    upstream429RetryTimeoutLoading,
    upstream429RetryTimeoutSeconds,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><TimerReset size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.upstream429Retry.title")}</h3>
          <p>{t("settings.upstream429Retry.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="upstream-429-retry-timeout">
            {t("settings.upstream429Retry.label")}
          </label>
          <DurationTimePicker
            id="upstream-429-retry-timeout"
            value={upstream429RetryTimeoutSeconds}
            disabled={upstream429RetryTimeoutLoading}
            onChange={onUpstream429RetryTimeoutChange}
          />
        </div>
      </div>
    </section>
  );
}

function AutoDisableStatusCodesCard({ settings }: { settings: SettingsPageProps }) {
  const {
    autoDisableStatusCodes,
    autoDisableStatusCodesLoading,
    language,
    onAutoDisableStatusCodesChange,
    t,
  } = settings;
  const options = useMemo(() => httpStatusOptions(language), [language]);
  return (
    <section className="settings-card">
      <div className="settings-icon"><ShieldCheck size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.autoDisableStatusCodes.title")}</h3>
          <p>{t("settings.autoDisableStatusCodes.description")}</p>
        </div>
        <div className="settings-field settings-field-wide auto-disable-status-codes-field">
          <label htmlFor="auto-disable-status-codes">
            {t("settings.autoDisableStatusCodes.label")}
          </label>
          <Select
            id="auto-disable-status-codes"
            mode="multiple"
            value={autoDisableStatusCodes}
            disabled={autoDisableStatusCodesLoading}
            loading={autoDisableStatusCodesLoading}
            placeholder={t("settings.autoDisableStatusCodes.placeholder")}
            maxTagCount="responsive"
            showSearch
            popupMatchSelectWidth={460}
            options={options.map(({ value, label }) => ({ value, label }))}
            filterOption={(input, option) => options
              .find((status) => status.value === option?.value)
              ?.searchText.includes(input.trim().toLowerCase()) ?? false}
            optionRender={(option) => {
              const status = options.find((item) => item.value === option.value);
              if (!status) return option.label;
              return (
                <div className="http-status-option">
                  <Checkbox checked={autoDisableStatusCodes.includes(status.value)} tabIndex={-1} />
                  <span><strong>{status.label}</strong><small>{status.description}</small></span>
                </div>
              );
            }}
            onChange={(statusCodes) => void onAutoDisableStatusCodesChange(
              [...statusCodes].sort((left, right) => left - right),
            )}
          />
        </div>
      </div>
    </section>
  );
}

export function UsageSettingsCards({ settings }: { settings: SettingsPageProps }) {
  return (
    <>
      <PetDockSettingsCard t={settings.t} />
      <CodexUsageSummaryCard settings={settings} />
      <TokenUsageCard settings={settings} />
      <QuotaWindowSyncCard t={settings.t} />
      <Upstream429RetryCard settings={settings} />
      <SseIdleTimeoutCard settings={settings} />
      <ResponseHeaderTimeoutCard settings={settings} />
      <ProxyTransportCard settings={settings} />
      <UsageNetworkErrorsCard settings={settings} />
      <AutoDisableStatusCodesCard settings={settings} />
    </>
  );
}
