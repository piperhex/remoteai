import { Button, ColorPicker, Modal, Segmented, Switch } from "antd";
import {
  AppWindow,
  CircleGauge,
  EyeOff,
  Languages,
  LayoutPanelLeft,
  LayoutPanelTop,
  LayoutGrid,
  Palette,
  Power,
  TableProperties,
} from "lucide-react";
import { LANGUAGE_OPTIONS } from "../../i18n";
import { LanguageSelect } from "../../../../../shared/localization/LanguageSelect";
import type { BubbleResetDisplay } from "../../types";
import { AutoUpdateSettingsCard } from "./AutoUpdateSettingsCard";
import { GlobalFontSettingsCard } from "./GlobalFontSettingsCard";
import { ChatGptLaunchPathCard } from "./ChatGptLaunchPathCard";
import { HelpAssistantSettingsCard } from "./HelpAssistantSettingsCard";
import type { SettingsPageProps } from "./types";
import { ClassicBubbleVisual } from "../../components/FloatingUsageBubble/ClassicBubbleVisual";
import { ThemeModeTabs } from "../../../../../shared/theme/ThemeModeTabs";
import { uiText } from "../../../../../shared/localization/uiText";

interface BasicSettingsCardsProps {
  bubbleStyleModalOpen: boolean;
  onBubbleStyleModalOpenChange: (open: boolean) => void;
  settings: SettingsPageProps;
}

function LanguageCard({ settings }: { settings: SettingsPageProps }) {
  const { language, onLanguageChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Languages size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.language.title")}</h3><p>{t("settings.language.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="language-selector">{t("settings.language.label")}</label>
          <LanguageSelect
            id="language-selector"
            label={t("settings.language.label")}
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={onLanguageChange}
          />
        </div>
      </div>
    </section>
  );
}

function ThemeCard({ settings }: { settings: SettingsPageProps }) {
  const { onThemeColorChange, onThemeModeChange, t, themeColor, themeColorLoading, themeMode } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Palette size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.theme.title")}</h3><p>{t("settings.theme.description")}</p>
        </div>
        <div className="settings-field settings-theme-controls">
          <ThemeModeTabs mode={themeMode} onChange={onThemeModeChange} t={uiText} />
          <div className="settings-field">
            <label htmlFor="theme-color-picker">{t("settings.theme.label")}</label>
            <span id="theme-color-picker" className="theme-color-picker">
              <ColorPicker
                value={themeColor}
                disabled={themeColorLoading}
                showText
                disabledAlpha
                format="hex"
                onChangeComplete={(color) => onThemeColorChange(color.toHexString())}
              />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function NavigationStyleCard({ settings }: { settings: SettingsPageProps }) {
  const { navigationStyle, onNavigationStyleChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><LayoutPanelLeft size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.navigationStyle.title")}</h3>
          <p>{t("settings.navigationStyle.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="navigation-style">{t("settings.navigationStyle.label")}</label>
          <Segmented id="navigation-style" value={navigationStyle} options={[
            {
              value: "top",
              label: (
                <span className="segmented-option-label">
                  <LayoutPanelTop size={14} />{t("settings.navigationStyle.top")}
                </span>
              ),
            },
            {
              value: "sidebar",
              label: (
                <span className="segmented-option-label">
                  <LayoutPanelLeft size={14} />{t("settings.navigationStyle.sidebar")}
                </span>
              ),
            },
          ]} onChange={(value) => onNavigationStyleChange(value as typeof navigationStyle)} />
        </div>
      </div>
    </section>
  );
}

function LaunchAtStartupCard({ settings }: { settings: SettingsPageProps }) {
  const { launchAtStartupEnabled, launchAtStartupLoading, onLaunchAtStartupChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><Power size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.launchAtStartup.title")}</h3>
          <p>{t("settings.launchAtStartup.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="launch-at-startup-enabled">{t("settings.launchAtStartup.label")}</label>
          <Switch
            id="launch-at-startup-enabled"
            checked={launchAtStartupEnabled}
            loading={launchAtStartupLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onLaunchAtStartupChange}
          />
        </div>
      </div>
    </section>
  );
}

function CloseToTrayCard({ settings }: { settings: SettingsPageProps }) {
  const { closeToTrayEnabled, closeToTrayLoading, onCloseToTrayChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><AppWindow size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.closeToTray.title")}</h3>
          <p>{t("settings.closeToTray.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="close-to-tray-enabled">{t("settings.closeToTray.label")}</label>
          <Switch
            id="close-to-tray-enabled"
            checked={closeToTrayEnabled}
            loading={closeToTrayLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onCloseToTrayChange}
          />
        </div>
      </div>
    </section>
  );
}

function FloatingBubbleCard({
  onOpen,
  settings,
}: {
  onOpen: () => void;
  settings: SettingsPageProps;
}) {
  const {
    bubbleResetDisplay,
    bubbleResetDisplayLoading,
    floatingBubbleEnabled,
    floatingBubbleLoading,
    onBubbleResetDisplayChange,
    onFloatingBubbleChange,
    t,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><CircleGauge size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.floatingBubble.title")}</h3>
          <p>{t("settings.floatingBubble.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="floating-bubble-enabled">{t("settings.floatingBubble.enabled")}</label>
          <Switch
            id="floating-bubble-enabled"
            checked={floatingBubbleEnabled}
            loading={floatingBubbleLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onFloatingBubbleChange}
          />
          <label htmlFor="floating-bubble-reset-display">
            {t("settings.floatingBubble.resetDisplay")}
          </label>
          <Segmented
            id="floating-bubble-reset-display"
            value={bubbleResetDisplay}
            disabled={bubbleResetDisplayLoading}
            options={[
              { value: "countdown", label: t("settings.floatingBubble.countdown") },
              { value: "resetAt", label: t("settings.floatingBubble.resetAt") },
            ]}
            onChange={(value) => onBubbleResetDisplayChange(value as BubbleResetDisplay)}
          />
          <label>{t("settings.floatingBubble.style")}</label>
          <Button className="floating-bubble-style-trigger" onClick={onOpen}>
            {t("settings.floatingBubble.chooseStyle")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BubbleStyleModal({
  onClose,
  open,
  settings,
}: {
  onClose: () => void;
  open: boolean;
  settings: SettingsPageProps;
}) {
  const { bubbleStyle, bubbleStyleLoading, onBubbleStyleChange, t } = settings;
  return (
    <Modal
      open={open}
      footer={null}
      width={760}
      title={t("settings.floatingBubble.styleModalTitle")}
      onCancel={onClose}
    >
      <p className="floating-bubble-style-modal-description">
        {t("settings.floatingBubble.styleModalDescription")}
      </p>
      <div className="floating-bubble-style-options">
        <button
          type="button"
          className={`floating-bubble-style-option ${bubbleStyle === "classic" ? "is-selected" : ""}`}
          disabled={bubbleStyleLoading}
          onClick={() => onBubbleStyleChange("classic")}
        >
          <span className="floating-bubble-style-preview classic" aria-hidden="true">
            <span className="floating-bubble floating-bubble-classic floating-bubble-demo">
              <ClassicBubbleVisual remaining={46} weeklyRemaining={68}
                weekLabel={t("settings.floatingBubble.weekShort")}
                resetLabel={<small className="floating-bubble-reset floating-bubble-reset-stacked">
                  <span>5{t("settings.floatingBubble.dayShort")}</span>
                  <span>01:35:12</span>
                </small>} />
            </span>
          </span>
          <span className="floating-bubble-style-option-copy">
            <strong>{t("settings.floatingBubble.classic")}</strong>
            <small>{t("settings.floatingBubble.classicDescription")}</small>
          </span>
        </button>
        <button
          type="button"
          className={`floating-bubble-style-option ${bubbleStyle === "glass" ? "is-selected" : ""}`}
          disabled={bubbleStyleLoading}
          onClick={() => onBubbleStyleChange("glass")}
        >
          <span className="floating-bubble-style-preview glass" aria-hidden="true">
            <span className="glass-preview-ring">
              <b>5%</b><small>{t("settings.floatingBubble.primaryRemaining")}</small>
            </span>
            <span className="glass-preview-stats">
              <span>{t("settings.floatingBubble.distanceToReset")}<b>3d 18h</b></span>
              <span>{t("settings.floatingBubble.remainingResets")}<b>0</b></span>
              <span>{t("settings.floatingBubble.secondaryUsed")}<b>95%</b></span>
              <span>
                {t("settings.floatingBubble.quotaStatus")}
                <b>{t("settings.floatingBubble.lowQuota")}</b>
              </span>
            </span>
          </span>
          <span className="floating-bubble-style-option-copy">
            <strong>{t("settings.floatingBubble.glass")}</strong>
            <small>{t("settings.floatingBubble.glassDescription")}</small>
          </span>
        </button>
      </div>
    </Modal>
  );
}

function PrivacyCard({ settings }: { settings: SettingsPageProps }) {
  const {
    hideAccountNotes,
    onHideAccountNotesChange,
    onPrivacyModeChange,
    privacyModeEnabled,
    privacyModeLoading,
    t,
  } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><EyeOff size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.privacy.title")}</h3><p>{t("settings.privacy.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="privacy-mode-enabled">{t("settings.privacy.enabled")}</label>
          <Switch
            id="privacy-mode-enabled"
            checked={privacyModeEnabled}
            loading={privacyModeLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onPrivacyModeChange}
          />
          <label htmlFor="hide-account-notes">{t("settings.privacy.hideNotes")}</label>
          <Switch
            id="hide-account-notes"
            checked={hideAccountNotes}
            loading={privacyModeLoading}
            checkedChildren={t("settings.autoRefresh.on")}
            unCheckedChildren={t("settings.autoRefresh.off")}
            onChange={onHideAccountNotesChange}
          />
        </div>
      </div>
    </section>
  );
}

function AccountDisplayCard({ settings }: { settings: SettingsPageProps }) {
  const { accountDisplayMode, onAccountDisplayModeChange, t } = settings;
  return (
    <section className="settings-card">
      <div className="settings-icon"><LayoutGrid size={23} /></div>
      <div className="settings-card-content">
        <div className="settings-card-copy">
          <h3>{t("settings.accountDisplay.title")}</h3>
          <p>{t("settings.accountDisplay.description")}</p>
        </div>
        <div className="settings-field">
          <label htmlFor="account-display-mode">{t("settings.accountDisplay.label")}</label>
          <Segmented
            id="account-display-mode"
            value={accountDisplayMode}
            options={[
              {
                value: "table",
                label: (
                  <span className="segmented-option-label">
                    <TableProperties size={14} />{t("settings.accountDisplay.table")}
                  </span>
                ),
              },
              {
                value: "cards",
                label: (
                  <span className="segmented-option-label">
                    <LayoutGrid size={14} />{t("settings.accountDisplay.cards")}
                  </span>
                ),
              },
            ]}
            onChange={(value) => onAccountDisplayModeChange(value as typeof accountDisplayMode)}
          />
        </div>
      </div>
    </section>
  );
}

export function AppearanceSettingsCards({
  bubbleStyleModalOpen,
  onBubbleStyleModalOpenChange,
  settings,
}: BasicSettingsCardsProps) {
  return (
    <>
      <LanguageCard settings={settings} />
      <GlobalFontSettingsCard />
      <NavigationStyleCard settings={settings} />
      <ThemeCard settings={settings} />
      <HelpAssistantSettingsCard language={settings.language} />
      <FloatingBubbleCard onOpen={() => onBubbleStyleModalOpenChange(true)} settings={settings} />
      <BubbleStyleModal
        onClose={() => onBubbleStyleModalOpenChange(false)}
        open={bubbleStyleModalOpen}
        settings={settings}
      />
      <AccountDisplayCard settings={settings} />
    </>
  );
}

export function SystemSettingsCards({ settings }: { settings: SettingsPageProps }) {
  return (
    <>
      <LaunchAtStartupCard settings={settings} />
      <CloseToTrayCard settings={settings} />
      <ChatGptLaunchPathCard language={settings.language} />
      <AutoUpdateSettingsCard settings={settings} />
    </>
  );
}

export function PrivacySettingsCards({ settings }: { settings: SettingsPageProps }) {
  return <PrivacyCard settings={settings} />;
}
