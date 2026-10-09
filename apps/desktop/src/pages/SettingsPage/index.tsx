import { type ReactNode, useState } from "react";
import {
  AppearanceSettingsCards,
  PrivacySettingsCards,
  SystemSettingsCards,
} from "../settings/BasicSettingsCards";
import { CloudSettingsCard, WebProxySettingsCard } from "../settings/ConnectionSettingsCards";
import {
  RefreshSettingsCards,
  SecuritySettingsCard,
  StorageSettingsCards,
} from "../settings/LocalSettingsCards";
import type { SettingsPageProps } from "../settings/types";
import { UsageSettingsCards } from "../settings/UsageSettingsCards";
import { TotpSyncSettingsCard } from "../settings/TotpSyncSettingsCard";
import { NetworkProxySettingsCard } from "../settings/NetworkProxySettings";
import { RemoteDesktopSettingsCard } from '../settings/RemoteDesktopSettingsCard';
import { ChatGptEnhancementsCard } from "../settings/ChatGptEnhancementsCard";
import styles from "./index.module.less";
import { TokenCostSettingsCard } from "../../components/TokenCostUnitSettings";

interface SettingsSectionProps {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}

const SETTINGS_SECTIONS = [
  "appearance",
  "system",
  "usage",
  "connection",
  "privacy",
  "storage",
] as const;

export function SettingsGroupsNav({ t }: Pick<SettingsPageProps, "t">) {
  return (
    <nav className="settings-groups-nav" aria-label={t("settings.sections.navigation")}>
      {SETTINGS_SECTIONS.map((section) => (
        <a key={section} href={`#settings-${section}`}>
          {t(`settings.sections.${section}.title`)}
        </a>
      ))}
    </nav>
  );
}

function SettingsSection({ children, description, id, title }: SettingsSectionProps) {
  return (
    <section className="settings-group" id={id}>
      <header className="settings-group-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="settings-group-cards">{children}</div>
    </section>
  );
}

export function SettingsPage(settings: SettingsPageProps) {
  const [bubbleStyleModalOpen, setBubbleStyleModalOpen] = useState(false);

  return (
    <div className={`${styles.styleScope} settings-page`}>
      <SettingsSection id="settings-appearance"
        title={settings.t("settings.sections.appearance.title")}
        description={settings.t("settings.sections.appearance.description")}>
        <AppearanceSettingsCards bubbleStyleModalOpen={bubbleStyleModalOpen}
          onBubbleStyleModalOpenChange={setBubbleStyleModalOpen} settings={settings} />
      </SettingsSection>
      <SettingsSection id="settings-system" title={settings.t("settings.sections.system.title")}
        description={settings.t("settings.sections.system.description")}>
        <SystemSettingsCards settings={settings} />
        <ChatGptEnhancementsCard t={settings.t} />
      </SettingsSection>
      <SettingsSection id="settings-usage" title={settings.t("settings.sections.usage.title")}
        description={settings.t("settings.sections.usage.description")}>
        <RefreshSettingsCards settings={settings} />
        <TokenCostSettingsCard providers={settings.providers} t={settings.t} />
        <UsageSettingsCards settings={settings} />
      </SettingsSection>
      <SettingsSection id="settings-connection"
        title={settings.t("settings.sections.connection.title")}
        description={settings.t("settings.sections.connection.description")}>
        <WebProxySettingsCard settings={settings} />
        <RemoteDesktopSettingsCard />
        <NetworkProxySettingsCard loading={settings.networkProxyLoading}
          onSave={settings.onNetworkProxySave} t={settings.t} value={settings.networkProxy} />
        {settings.showCustomCloudServer && <CloudSettingsCard settings={settings} />}
      </SettingsSection>
      <SettingsSection id="settings-privacy" title={settings.t("settings.sections.privacy.title")}
        description={settings.t("settings.sections.privacy.description")}>
        <PrivacySettingsCards settings={settings} />
        <TotpSyncSettingsCard settings={settings} />
        <SecuritySettingsCard settings={settings} />
      </SettingsSection>
      <SettingsSection id="settings-storage" title={settings.t("settings.sections.storage.title")}
        description={settings.t("settings.sections.storage.description")}>
        <StorageSettingsCards settings={settings} />
      </SettingsSection>
    </div>
  );
}
