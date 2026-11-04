import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { useContext, useEffect, useRef, useState } from "react";
import { Button, Popconfirm } from "antd";
import type { Content, SkillReference } from "../../../../../shared/conversation/types";
import type { SubmitMessageEdit } from "../../../../../shared/conversation/messageEditContent";
import { MessageEditorImages } from "./MessageEditorImages";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { useMessageEditDraft } from "./useMessageEditDraft";
import { MessageEditContext } from "./messageEditContext";
import styles from "./UserMessage.module.less";

export function UserMessageEditor({ text, images, skills, disabled, onSubmit, onDelete, onCancel }: {
  text: string; images: Content[]; skills: SkillReference[];
  disabled: boolean; onSubmit: SubmitMessageEdit; onDelete?: () => Promise<boolean>; onCancel: () => void;
}) {
  const editor = useRef<SkillInputHandle>(null);
  const { cwd, active } = useContext(MessageEditContext);
  const draft = useMessageEditDraft({ text, images, skills });
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const remove = async () => {
    if (inFlight.current || disabled || !active || !onDelete) return;
    inFlight.current = true;
    setSaving(true);
    try { if (await onDelete()) onCancel(); }
    finally { inFlight.current = false; setSaving(false); }
  };
  useEffect(() => { editor.current?.focus(); }, []);
  const submit = async () => {
    if (inFlight.current || disabled || !active || draft.reading || draft.isReading() || !draft.draft.text.trim()) return;
    inFlight.current = true;
    setSaving(true);
    try {
      if (await onSubmit(draft.content())) onCancel();
    }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <div className={styles.editor}>
    <MessageEditorImages images={draft.images} removed={draft.removed} disabled={saving || disabled}
      onRemove={draft.remove} />
    <SkillInput ref={editor} value={draft.draft} draftKey="message-edit" cwd={cwd} active={active}
      connected={!disabled} disabled={saving || disabled} editing={{ onCancel, className: styles.editorInput }}
      placeholder={uiText("client.workspaceActions.typeAMessageOrToChooseASkill")} onChange={draft.setDraft} onPaste={draft.paste}
      onSend={() => void submit()} />
    {draft.error && <p className={styles.editorError} role="status">{remoteErrorText(draft.error)}</p>}
    <div className={styles.editorActions}>
      {onDelete && <Popconfirm title={uiText("client.messageEditing.deleteThisMessage")}
        description={uiText("client.messageEditing.thisMessageAndAllFollowingMessagesWillBeDeletedThis")}
        overlayStyle={{ maxWidth: 400 }} okText={uiText("client.projectBrowser.deleted")} cancelText={uiText("client.accounts.cancel")}
        okButtonProps={{ danger: true, autoInsertSpace: false }} cancelButtonProps={{ autoInsertSpace: false }}
        disabled={saving || disabled || !active} onConfirm={remove}>
        <Button danger className={styles.deleteButton} autoInsertSpace={false}
          disabled={saving || disabled || !active}>{uiText("client.messageEditing.deleteMessage")}</Button>
      </Popconfirm>}
      <Button className={styles.cancelButton} autoInsertSpace={false} aria-label={uiText("client.workspaceActions.cancelEditing")}
        disabled={saving} onClick={onCancel}>{uiText("client.accounts.cancel")}</Button>
      <Button className={styles.sendButton} autoInsertSpace={false} type="primary"
        loading={saving} disabled={disabled || draft.reading || !draft.draft.text.trim()}
        onClick={() => void submit()}>{uiText("client.conversation.sent")}</Button>
    </div>
  </div>;
}
