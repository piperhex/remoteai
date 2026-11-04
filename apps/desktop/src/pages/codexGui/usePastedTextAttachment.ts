import { displayError } from '../../../../../shared/localization/uiText';
import { useState } from 'react';

import { readFileBase64 } from '../../../../../shared/chat/fileData';
import { checkFileUploadSize } from '../../../../../shared/remote-chat/policy';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';

interface Options {
  key: string;
  addAttachments: (items: AttachmentReference[]) => void;
  report: (message: string) => void;
}

export function usePastedTextAttachment({ key, addAttachments, report }: Options) {
  const [pending, setPending] = useState<Record<string, number>>({});
  const changePending = (delta: number) => setPending(values =>
    ({ ...values, [key]: (values[key] ?? 0) + delta }));
  const add = async (file: File) => {
    changePending(1);
    try {
      checkFileUploadSize(file.size, 'relay');
      const data = await readFileBase64(file);
      // This callback belongs to the original draft, even after switching conversations.
      addAttachments([{ kind: 'file', name: file.name, path: '', data }]);
    } catch (cause) {
      report(displayError(cause instanceof Error ? cause.message : "client.workspaceActions.couldNotPasteFilesCopyThemAgainAndRetry"));
    } finally { changePending(-1); }
  };
  return { add, reading: Boolean(pending[key]) };
}
