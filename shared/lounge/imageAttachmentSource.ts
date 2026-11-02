import { base64Bytes } from '../remote-chat/policy';
import { fromByteArray, toByteArray } from 'base64-js';
import type { AttachmentSource } from './attachments';

export function imageAttachmentSource(data: string): AttachmentSource {
  const comma = data.indexOf(',');
  const mime = data.slice(5, data.indexOf(';'));
  return { name: `image.${mime.split('/')[1]}`, mime, size: base64Bytes(data),
    // Unaligned range reads also occur when resuming downloads.
    read: async (offset, length) => {
      const start = Math.floor(offset / 3) * 4;
      const end = Math.ceil((offset + length) / 3) * 4;
      return fromByteArray(toByteArray(data.slice(comma + 1 + start, comma + 1 + end))
        .subarray(offset % 3, offset % 3 + length));
    } };
}
