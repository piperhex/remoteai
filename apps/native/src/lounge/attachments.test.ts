import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), info: vi.fn(), read: vi.fn() }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system', () => ({ getInfoAsync: mocks.info, readAsStringAsync: mocks.read,
  EncodingType: { Base64: 'base64' } }));
vi.mock('react-native-blob-util', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('../chat/fileDownloadTarget', () => ({}));
vi.mock('expo-sqlite/kv-store', () => ({ default: {
  getItemSync: (key: string) => mocks.values.get(key),
  setItemSync: (key: string, value: string) => { mocks.values.set(key, value); },
} }));
import { nativeAttachmentImages } from './attachments';

beforeEach(() => { vi.resetAllMocks(); mocks.values.clear(); });

it('reopens existing image files for historical transfers after restart without loading the whole file', async () => {
  await nativeAttachmentImages('alice').put('image', 'file:///cached-image');
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 700_001 });
  mocks.read.mockResolvedValue('AQIDBA==');
  const source = await nativeAttachmentImages('alice').source!('image');
  expect(source?.size).toBe(700_001);
  expect(await source?.read(262144, 4)).toBe('AQIDBA==');
  expect(mocks.read).toHaveBeenCalledWith('file:///cached-image', {
    encoding: 'base64', position: 262144, length: 4,
  });
  expect(await nativeAttachmentImages('bob').source!('image')).toBeUndefined();
});

it('does not advertise missing files or directories as recoverable images', async () => {
  const store = nativeAttachmentImages('alice');
  await store.put('image', 'file:///removed-image');
  mocks.info.mockResolvedValue({ exists: false });
  expect(await store.source!('image')).toBeUndefined();
  mocks.info.mockResolvedValue({ exists: true, isDirectory: true });
  expect(await store.source!('image')).toBeUndefined();
  expect(mocks.read).not.toHaveBeenCalled();
});
