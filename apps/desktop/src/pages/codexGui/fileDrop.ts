import { getCurrentWebview } from '@tauri-apps/api/webview';
import { invoke } from '@tauri-apps/api/core';
import type { SubscribeFileDrop } from '../../../../../shared/chat/useFileDrop';
import { fileUploadTotalByteLimit, getChatPolicy, MIB } from '../../../../../shared/remote-chat/policy';
import { MAX_CHAT_IMAGES } from '../../../../../shared/remote-chat/attachments';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';
import { nativeFile } from './nativeFile';

interface DroppedFile { name: string; mimeType: string; data: string }
interface DroppedFiles { references: AttachmentReference[]; files: DroppedFile[] }

export const subscribeFileDrop: SubscribeFileDrop = async listener =>
  getCurrentWebview().onDragDropEvent(event => listener(event.payload));

export async function droppedReferences(paths: string[]) {
  const result = await invoke<DroppedFiles>('codex_gui_dropped_files', { request: { paths, mode: 'local' } });
  return result.references;
}

export async function readDroppedFiles(paths: string[]): Promise<File[]> {
  const maxBytes = Math.min(Number.MAX_SAFE_INTEGER,
    fileUploadTotalByteLimit() + getChatPolicy().imageSourceMaxMb * MIB * MAX_CHAT_IMAGES);
  const result = await invoke<DroppedFiles>('codex_gui_dropped_files', {
    request: { paths, mode: 'remote', maxBytes },
  });
  const files: File[] = [];
  for (const file of result.files) files.push(await nativeFile(file));
  return files;
}
