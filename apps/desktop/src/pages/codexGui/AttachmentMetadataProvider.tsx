import { useCallback, useContext, type ReactNode } from 'react';
import { AttachmentMetadataContext, readAttachmentMetadata } from '../../../../../shared/chat/attachmentMetadata';
import { fileApi, FileThreadContext } from '../../../../../shared/conversation/fileApi';
import { FileEnvironmentContext } from '../../../../../shared/conversation/fileEnvironment';

/** Inherit the selected remote computer's reader; local composers can inspect files before a chat exists. */
export function AttachmentMetadataProvider({ children }: { children: ReactNode }) {
  const inherited = useContext(AttachmentMetadataContext);
  const environment = useContext(FileEnvironmentContext);
  const threadId = useContext(FileThreadContext);
  const perform = (environment?.actions ?? fileApi).perform;
  const read = useCallback((path: string) => readAttachmentMetadata({ perform, path, threadId }), [perform, threadId]);
  return <AttachmentMetadataContext.Provider value={inherited ?? read}>{children}</AttachmentMetadataContext.Provider>;
}
