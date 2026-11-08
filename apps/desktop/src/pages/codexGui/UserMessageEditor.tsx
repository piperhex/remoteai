import { useContext, useEffect, useRef } from 'react';
import { uiText } from '../../../../../shared/localization/uiText';
import type { Content, SkillReference } from '../../../../../shared/conversation/types';
import type { SubmitMessageEdit } from '../../../../../shared/conversation/messageEditContent';
import { MessageEditor } from '../../../../../shared/conversation/MessageEditor';
import { SkillInput, type SkillInputHandle } from './SkillInput';
import { MessageEditContext } from './messageEditContext';

export function UserMessageEditor(props: {
  text: string; images: Content[]; skills: SkillReference[];
  disabled: boolean; onSubmit: SubmitMessageEdit; onDelete?: () => Promise<boolean>; onCancel: () => void;
}) {
  const editor = useRef<SkillInputHandle>(null);
  const { cwd, active } = useContext(MessageEditContext);
  useEffect(() => { editor.current?.focus(); }, []);
  return <MessageEditor {...props} active={active} renderInput={({ className, onCancel, ...input }) =>
    <SkillInput {...input} ref={editor} draftKey="message-edit" cwd={cwd} connected={!props.disabled}
      editing={{ onCancel, className }}
      placeholder={uiText('client.workspaceActions.typeAMessageOrToChooseASkill')} />} />;
}
