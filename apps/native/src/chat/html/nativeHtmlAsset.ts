import { fromByteArray, toByteArray } from 'base64-js';
import { downloadFile, type FileClient } from '../../../../../shared/remote-chat/fileDownload';
import { checkPreviewSize, previewMimeType } from '../../../../../shared/file-preview/kinds';

/** Keep the existing authenticated file transfer and cancellation/close behavior on native. */
export async function nativeHtmlAsset(options: {
  client: FileClient; threadId: string; path: string; signal: AbortSignal;
}) {
  let mime = '', offset = 0;
  let bytes = new Uint8Array();
  await downloadFile({ ...options, progress: () => {}, target: async info => {
    checkPreviewSize(info.size);
    mime = info.mimeType && info.mimeType !== 'application/octet-stream' ? info.mimeType : previewMimeType(options.path);
    bytes = new Uint8Array(info.size);
    return { write: async value => { const chunk = toByteArray(value); bytes.set(chunk, offset); offset += chunk.length; },
      finish: async () => {}, dispose: async () => {} };
  } });
  return { base64: fromByteArray(bytes), mime };
}
