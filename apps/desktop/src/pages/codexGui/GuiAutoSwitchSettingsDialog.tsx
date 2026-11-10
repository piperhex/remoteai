import { displayText } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";
import { useState, type CSSProperties } from "react";
import { Button, ConfigProvider, Grid, Modal, Spin, Tabs } from "antd";
import { ArrowLeftRight, Circle, Image, MessageSquareText, Palette, Settings2, Type } from "lucide-react";
import type { Provider } from "../../types";
import type { GuiSettingsAccount, GuiSettingsClient } from '../../../../../shared/remote-chat/guiSettings';
import { DEFAULT_FONT_SIZE, useGlobalFontSize } from '../../../../../shared/appearance/fontSize';
import { useGuiAutoSwitchSettings } from "./useGuiAutoSwitchSettings";
import { GuiAutoSwitchPanel } from "./GuiAutoSwitchPanel";
import { GuiAppearanceSettings } from "../../../../../shared/conversation/GuiAppearanceSettings";
import { GuiMessageSettings } from "../../../../../shared/conversation/GuiMessageSettings";
import { GuiThemeSettings } from "./GuiThemeSettings";
import { GuiSkinSettings } from "./GuiSkinSettings";
import { GuiSystemPromptSettings } from "./GuiSystemPromptSettings";
import { GuiModelContextSettings } from "./GuiModelContextSettings";
import styles from "./GuiAutoSwitchSettingsDialog.module.less";

const sections = [
  { key: "accounts", label: "client.workspaceSettings.automaticAccountSwitching", icon: ArrowLeftRight },
  { key: "context", label: "client.guiSettings.context", icon: MessageSquareText },
  { key: "messages", label: "client.messageQueue.settings", icon: MessageSquareText },
  { key: "appearance", label: "client.workspaceSettings.appearance.785d65", icon: Type },
  { key: "theme", label: "client.configLabels.theme", icon: Palette },
  { key: "skin", label: "client.workspaceSettings.theme", icon: Image },
  { key: "systemPrompts", label: "client.workspaceSettings.systemPrompts", icon: MessageSquareText },
] as const;

type Props = { accounts: GuiSettingsAccount[]; providers: Pick<Provider, "id" | "name">[];
  privacyMode: boolean; onClose: () => void; client?: GuiSettingsClient;
  accountCatalog?: { loading: boolean; failed: boolean; retry: () => void } };

export function GuiAutoSwitchSettingsDialog({
  accounts, providers, privacyMode, onClose, client, accountCatalog,
}: Props) {
  const editor = useGuiAutoSwitchSettings(client?.autoSwitch);
  const fontSize = useGlobalFontSize();
  const screens = Grid.useBreakpoint();
  const [tab, setTab] = useState("accounts");
  const accountsUnavailable = accountCatalog?.loading || accountCatalog?.failed;
  const save = async () => {
    if (accountsUnavailable) return;
    if (await editor.save(accounts.map((account) => account.id))) onClose();
    else setTab("accounts");
  };
  const accountPanel = () => {
    if (accountCatalog?.loading) return <div className={styles.loading} role="status">
      <Spin size="small" />{uiText('client.composer.loadingSettings')}</div>;
    if (accountCatalog?.failed) return <div className={styles.error} role="alert">
      {uiText('client.workspaceActions.couldNotLoadSettingsPleaseTryAgain')}
      <Button onClick={accountCatalog.retry}>{uiText('client.terminal.retry')}</Button>
    </div>;
    return <GuiAutoSwitchPanel editor={editor} accounts={accounts} providers={providers} privacyMode={privacyMode} />;
  };
  const panels = {
    accounts: accountPanel(),
    context: tab === "context" && <GuiModelContextSettings api={client?.context} />,
    messages: <GuiMessageSettings />,
    appearance: <GuiAppearanceSettings />,
    theme: <GuiThemeSettings />,
    skin: tab === "skin" && <GuiSkinSettings />,
    systemPrompts: <GuiSystemPromptSettings api={client?.systemPrompts} />,
  };
  return <ConfigProvider theme={{ token: { fontSize } }}>
  <Modal open centered width="min(1240px, calc(100vw - 48px))" className={styles.dialog}
    style={{ '--app-font-scale': fontSize / DEFAULT_FONT_SIZE } as CSSProperties}
    title={<div className={styles.title}><span className={styles.titleIcon}><Settings2 size={21} /></span>
      <div><span>{uiText("client.workspaceSettings.codexGuiSettings")}</span><p>{uiText("client.workspaceSettings.makeCodexGuiWorkTheWayYouLike")}</p></div></div>}
    onCancel={onClose} closable={!editor.saving} maskClosable={!editor.saving} keyboard={!editor.saving}
    footer={<div className={styles.footer}>
      <span className={styles.saveHint} data-dirty={editor.dirty}>
        <Circle size={7} fill="currentColor" aria-hidden="true" />
        {uiText(editor.dirty ? "client.guiSettings.accountSettingsHaveUnsavedChanges" : tab === "accounts"
          ? "client.guiSettings.clickSaveToApplyAccountChanges" : "client.guiSettings.changesOnThisPageSaveAutomatically")}</span>
      <div>{tab !== "accounts" && !editor.dirty ? <Button onClick={onClose}>{uiText("client.shared.done")}</Button> : <>
        <Button disabled={editor.saving} onClick={onClose}>{uiText("client.accounts.cancel")}</Button>
        <Button type="primary" loading={editor.saving}
          disabled={editor.loading || !editor.settings || accountsUnavailable}
          onClick={() => void save()}>{uiText("client.projectBrowser.save")}</Button>
      </>}</div>
    </div>}>
    <Tabs activeKey={tab} onChange={setTab} tabPosition={screens.md ? "left" : "top"} className={styles.tabs}
      items={sections.filter(({ key }) => !client || (key !== 'theme' && key !== 'skin'))
        .map(({ key, label, icon: Icon }) => ({ key, disabled: editor.saving,
        label: <span className={styles.navLabel}><Icon size={17} strokeWidth={1.7} aria-hidden="true" />
          {displayText(label)}</span>,
        children: <div className={styles.section}>
          <div className={styles.sectionBody}>{panels[key]}</div>
        </div>,
      }))} />
  </Modal></ConfigProvider>;
}
