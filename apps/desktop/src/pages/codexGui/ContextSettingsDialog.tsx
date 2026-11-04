import { uiText } from "../../../../../shared/localization/uiText";
import { useId, useState } from "react";
import { AutoComplete, Button, Input, Modal, Spin } from "antd";
import { CONTEXT_CAPACITY_PRESETS_K } from "../../../../../shared/remote-chat/contextSettings";
import { useContextSettings } from "./useContextSettings";
import styles from "./ContextUsageButton.module.less";

const capacityOptions = CONTEXT_CAPACITY_PRESETS_K.map((value) => ({ value: String(value), label: `${value}K` }));

export function ContextSettingsDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const editor = useContextSettings(threadId);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const id = useId();
  const save = async () => { if (await editor.save()) onClose(); };
  return <Modal open centered width={360} title={uiText("client.chat.conversationContext")} onCancel={onClose}
    closable={!editor.saving} maskClosable={!editor.saving} keyboard={!editor.saving}
    footer={<>
      <Button disabled={editor.saving} onClick={onClose}>{uiText("client.accounts.cancel")}</Button>
      <Button type="primary" loading={editor.saving} disabled={editor.loading || !editor.loaded}
        onClick={() => void save()}>{uiText("client.projectBrowser.save")}</Button>
    </>}>
    <div className={styles.settings}>
      <p className={styles.hint}>{uiText("client.chat.appliesToThisConversationImmediatelyAnActiveReplyWillPause")}</p>
      {editor.loading && <div role="status"><Spin size="small" />  {uiText("client.composer.loadingSettings")}</div>}
      {editor.loaded && <>
        <label htmlFor={id}>{uiText("client.chat.contextCapacityKTokens")}</label>
        <AutoComplete id={id} value={editor.value} options={capacityOptions} disabled={editor.saving}
          onChange={editor.setValue} onOpenChange={setPresetsOpen} defaultActiveFirstOption={false}>
          <Input aria-label={uiText("client.chat.contextCapacityKTokens")} inputMode="decimal" placeholder={uiText("client.chat.chooseOrEnterACapacityLeaveBlankForDefault")}
            onPressEnter={(event) => { if (!presetsOpen && !event.nativeEvent.isComposing) void save(); }} />
        </AutoComplete>
        <div className={styles.settingHelp}>
          <span className={styles.hint}>{uiText("client.chat.1K1000TokensLeaveBlankToUseThe")}</span>
          <Button type="link" size="small" disabled={editor.saving} onClick={() => editor.setValue("")}>{uiText("client.chat.restoreDefaults")}</Button>
        </div>
        <p className={styles.hint}>{uiText("client.chat.usageUpdatesAfterAReplyAvailableCapacityDependsOnModel")}</p>
      </>}
      {editor.error && <div role="alert" className={styles.error}>{editor.error}
        {!editor.loaded && <Button type="link" size="small" onClick={editor.retry}>{uiText("client.terminal.retry")}</Button>}
      </div>}
    </div>
  </Modal>;
}
