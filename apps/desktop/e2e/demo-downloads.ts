import type { Thread } from '../src/pages/codexGui/types';
import { demoVideoResponse } from './demo-videos';
import thumbnail from '../src-tauri/icons/32x32.png?inline';
import { demoOriginal } from './demo-images';
import { detailText } from './demo-details';

const MIB = 1024 * 1024;
const sizes: Record<string, number> = {
  'regression.apk': 32 * MIB + 17, 'small.zip': MIB + 3, 'outside.bin': MIB + 7, empty: 0,
};
const handles = new Map<string, number>();
const videoHandles = new Set<string>();
const previewHandles = new Map<string, Uint8Array>();
let revision = 0;
let corrupt = false;

export function configureDownloadFixture(action: string) {
  if (action === 'downloads-change') revision += 1;
  if (action === 'downloads-corrupt') corrupt = true;
  if (action === 'downloads-valid') corrupt = false;
}

export function demoDownloads(input: Record<string, unknown>): { value: unknown } | undefined {
  if (input.operation === 'previewOpen') {
    const id = crypto.randomUUID();
    const image = input.preview === 'thumbnail' ? thumbnail : demoOriginal();
    const bytes = input.preview === 'text' ? new TextEncoder().encode(detailText)
      : Uint8Array.from(atob(image.split(',')[1]), character => character.charCodeAt(0));
    previewHandles.set(id, bytes);
    return { value: { id, size: bytes.length, name: input.preview === 'text' ? 'preview.txt' : 'image.png',
      mimeType: input.preview === 'text' ? 'text/plain' : 'image/png', revision: 'preview-v1' } };
  }
  const preview = previewHandles.get(String(input.id));
  if (preview && input.operation === 'fileClose') {
    previewHandles.delete(String(input.id)); return { value: null };
  }
  if (preview && input.operation === 'fileRead') {
    const offset = Number(input.offset);
    const bytes = preview.subarray(offset, offset + Number(input.length));
    return { value: { offset, data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) } };
  }
  if (input.operation === 'downloadBrowse') {
    const root = input.scope === 'computer' && !input.directory;
    const directory = String(input.directory || (root ? '' : 'F:/projects/demo'));
    const names = root ? ['C:/', 'F:/'] : Object.keys(sizes);
    const entries = names.map(name => ({ name, path: root ? name : `${directory.replace(/\/$/, '')}/${name}`,
      directory: root }));
    return { value: { directory, parent: root || input.scope === 'project' ? null : '', entries, truncated: false } };
  }
  if (input.operation === 'downloadOpen') {
    const name = String(input.path).split('/').pop()!;
    if (name === 'test.mp4') {
      const info = demoVideoResponse({ ...input, operation: 'videoOpen' }) as { id: string };
      videoHandles.add(info.id);
      return { value: { ...info, name, revision: 'parity-video-v1' } };
    }
    if (!(name in sizes)) throw new Error('Missing download fixture');
    const id = crypto.randomUUID();
    handles.set(id, sizes[name]);
    return { value: { id, name, size: sizes[name],
      mimeType: 'application/octet-stream', revision: `fixture-v${revision}` } };
  }
  if (videoHandles.has(String(input.id)) && ['fileRead', 'fileClose'].includes(String(input.operation))) {
    if (input.operation === 'fileClose') videoHandles.delete(String(input.id));
    return { value: demoVideoResponse({ ...input, operation: String(input.operation).replace('file', 'video') }) };
  }
  if (!handles.has(String(input.id))) return;
  if (input.operation === 'fileClose') { handles.delete(String(input.id)); return { value: null }; }
  if (input.operation === 'fileRead') {
    const offset = Number(input.offset);
    const bytes = Array.from({ length: Number(input.length) }, (_, index) =>
      String.fromCharCode((offset + index) % 251));
    return { value: { offset, data: corrupt ? '!' : btoa(bytes.join('')) } };
  }
}

export function seedDownloads(thread: Thread) {
  thread.turns = [{ id: 'download-turn', status: 'completed', items: [
    { id: 'download-question', type: 'userMessage', text: '下载管理测试' },
    { id: 'download-link', type: 'agentMessage', text: '[下载安装包](F:/projects/demo/regression.apk)' },
  ] }];
}
