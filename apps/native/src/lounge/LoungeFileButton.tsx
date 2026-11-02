import { useRef, useState } from 'react';
import type { LoungeDraft } from '../../../../shared/lounge/types';
import { checkAttachmentSize } from '../../../../shared/lounge/attachments';
import { pickLoungeFile } from './attachments';
import { displayText, t } from '../i18n';
import { LoungeComposerAction } from './LoungeComposerAction';
import { sendError } from '../../../../shared/lounge/contacts';

export function LoungeFileButton({ send, disabled, close }: {
  send: (draft: LoungeDraft) => Promise<void>; disabled: boolean; close: () => void;
}) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const choose = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const file = await pickLoungeFile();
      if (!file) return;
      checkAttachmentSize(file, 'file', 'private');
      await send({ text: '', images: [], files: [file] }); close();
    } catch (failure) { setError(sendError(failure)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <LoungeComposerAction icon="attach-outline" label={t('client.lounge.sendFile')}
    disabled={disabled || busy} onPress={() => void choose()} error={error ? displayText(error) : undefined} />;
}
