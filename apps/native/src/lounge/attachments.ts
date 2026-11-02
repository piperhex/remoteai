import * as Picker from 'expo-document-picker';
import * as Files from 'expo-file-system';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { randomUUID } from 'expo-crypto';
import type { AttachmentSink, AttachmentSource, LoungeAttachment } from '../../../../shared/lounge/attachments';
import { nativeDownloadTarget } from '../chat/fileDownloadTarget';
import Storage from 'expo-sqlite/kv-store';
import type { AttachmentImageStore } from '../../../../shared/lounge/attachmentCache';

export function nativeAttachmentImages(scope: string): AttachmentImageStore {
  const key = (id: string) => `lounge-image:${JSON.stringify([scope, id])}`;
  const store: AttachmentImageStore = { sink: nativeAttachmentSink,
    get: async id => {
      const uri = Storage.getItemSync(key(id));
      return uri && (await Files.getInfoAsync(uri)).exists ? uri : undefined;
    },
    put: async (id, uri) => { Storage.setItemSync(key(id), uri); },
  };
  store.source = async id => {
    const uri = await store.get(id);
    if (!uri) return;
    const info = await Files.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) return;
    return { name: 'image', mime: 'application/octet-stream', size: info.size,
      read: (position, length) => Files.readAsStringAsync(uri, { encoding: Files.EncodingType.Base64,
        position, length }) };
  };
  return store;
}

export async function pickLoungeFile(): Promise<AttachmentSource | undefined> {
  const selected = await Picker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
  if (selected.canceled) return;
  const file = selected.assets[0], info = await Files.getInfoAsync(file.uri);
  if (!info.exists || info.isDirectory) throw new Error('client.lounge.fileUnavailable');
  return { name: file.name, size: info.size, mime: file.mimeType || 'application/octet-stream',
    read: (position, length) => Files.readAsStringAsync(file.uri, { encoding: Files.EncodingType.Base64,
      position, length }) };
}

export async function nativeAttachmentSink(file: LoungeAttachment): Promise<AttachmentSink> {
  if (file.kind === 'file') {
    const target = await nativeDownloadTarget({ id: file.id, name: file.name, size: file.size, mimeType: file.mime });
    return { write: target.write, finish: async () => {
      try { await target.finish(); return ''; } finally { await target.dispose(); }
    }, abort: target.dispose };
  }
  const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/lounge-image-${randomUUID()}`;
  const stream = await ReactNativeBlobUtil.fs.writeStream(path, 'base64', false);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await stream.close(); } };
  return { write: async data => { await stream.write(data); },
    finish: async () => { await close(); return `file://${path}`; },
    abort: async () => { try { await close(); } finally { await ReactNativeBlobUtil.fs.unlink(path); } } };
}
