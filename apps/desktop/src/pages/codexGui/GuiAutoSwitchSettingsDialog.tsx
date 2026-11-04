import { displayText } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button, Grid, Modal, Tabs } from "antd";
import { ArrowLeftRight, Circle, Image, MessageSquareText, Palette, Settings2, Type } from "lucide-react";
import type { Account, Provider } from "../../types";
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

type Props = { accounts: Account[]; providers: Pick<Provider, "id" | "name">[];
  privacyMode: boolean; onClose: () => void };

export function GuiAutoSwitchSettingsDialog({ accounts, providers, privacyMode, onClose }: Props) {
  const editor = useGuiAutoSwitchSettings();
  const screens = Grid.useBreakpoint();
  const [tab, setTab] = useState("accounts");
  const save = async () => {
    if (await editor.save(accounts.map((account) => account.id))) onClose();
    else setTab("accounts");
  };
  const panels = {
    accounts: <GuiAutoSwitchPanel editor={editor} accounts={accounts} providers={providers} privacyMode={privacyMode} />,
    context: tab === "context" && <GuiModelContextSettings />,
    messages: <GuiMessageSettings />,
    appearance: <GuiAppearanceSettings />,
    theme: <GuiThemeSettings />,
    skin: tab === "skin" && <GuiSkinSettings />,
    systemPrompts: <GuiSystemPromptSettings />,
  };
  return <Modal open centered width="min(1240px, calc(100vw - 48px))" className={styles.dialog}
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
        <Button type="primary" loading={editor.saving} disabled={editor.loading || !editor.settings}
          onClick={() => void save()}>{uiText("client.projectBrowser.save")}</Button>
      </>}</div>
    </div>}>
    <Tabs activeKey={tab} onChange={setTab} tabPosition={screens.md ? "left" : "top"} className={styles.tabs}
      items={sections.map(({ key, label, icon: Icon }) => ({ key, disabled: editor.saving,
        label: <span className={styles.navLabel}><Icon size={17} strokeWidth={1.7} aria-hidden="true" />
          {displayText(label)}</span>,
        children: <div className={styles.section}>
          <div className={styles.sectionBody}>{panels[key]}</div>
        </div>,
      }))} />
  </Modal>;
}
