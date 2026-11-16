import { afterEach, expect, it, vi } from 'vitest';
import { NativeBulkSender } from './bulkNativeSender';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { bulkCapability } from '../../../../shared/remote-chat/bulkControl';
import { decodeBulkRecord } from '../../../../shared/remote-chat/bulkProtocol';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import { nativeSenderFixture } from './bulkNativeTestFixture';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const transferId = crypto.randomUUID(), epoch = crypto.randomUUID();
  const context = { transferId, epoch, manifestId: 'f'.repeat(64), sessionId: 'session',
    desktopKey: 'host', clientKey: 'viewer', desktop: true };
  const cipher = new BulkCipher(new Uint8Array(32).fill(7), context);
  const encrypt = vi.spyOn(cipher, 'encrypt');
  mocks.invoke.mockImplementation(nativeSenderFixture(() => new Uint8Array(1_048_576)));
  const link = { connectionMode: 'direct', createBulkCipher: () => cipher } as unknown as ChatLink;
  const sender = await NativeBulkSender.open({ link, manifestId: context.manifestId, recordBytes: 16384,
    open: { transferId, epoch, id: crypto.randomUUID(), path: 'direct', capability: bulkCapability('synced-file') } });
  return { sender, encrypt };
}

it('keeps native nonce allocation and delivery ordered while two block sends overlap', async () => {
  const { sender, encrypt } = await fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const sequences: number[] = [];
  const first = sender.send({ block: 0, offset: 0, requestId: crypto.randomUUID() }, async records => {
    sequences.push(...records.map(record => decodeBulkRecord(record).header.sequence)); await blocked;
  });
  const second = sender.send({ block: 1, offset: 0, requestId: crypto.randomUUID() }, async records => {
    sequences.push(...records.map(record => decodeBulkRecord(record).header.sequence));
  });
  await vi.waitFor(() => expect(sequences.length).toBe(16));
  release(); await Promise.all([first, second]);
  expect(sequences).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
  expect(encrypt).not.toHaveBeenCalled(); sender.destroy();
});

it('drops an in-flight native reply after cancellation without sending ciphertext', async () => {
  const { sender } = await fixture();
  let resolve!: (value: ArrayBuffer) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise<ArrayBuffer>(done => { resolve = done; }));
  const consume = vi.fn(async () => {});
  const pending = sender.send({ block: 0, offset: 0, requestId: crypto.randomUUID() }, consume);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  sender.destroy(); resolve(new ArrayBuffer(0)); await rejected;
  expect(consume).not.toHaveBeenCalled();
});

it('sends directly from the native cipher to native RTC without returning records through IPC', async () => {
  const { sender, encrypt } = await fixture();
  const commit = vi.fn();
  mocks.invoke.mockImplementationOnce(async (command, options) => {
    expect(command).toBe('codex_gui_file_bulk_sender_send');
    expect(commit).toHaveBeenCalledOnce();
    expect(options.request.target).toEqual({ peer: 'native-peer', channel: 'file-channel' });
    return { usefulBytes: 100, wireBytes: 188 };
  });
  await expect(sender.sendDirect({ block: 0, offset: 0, requestId: crypto.randomUUID() },
    { peer: 'native-peer', channel: 'file-channel' }, commit)).resolves.toEqual({ usefulBytes: 100, wireBytes: 188 });
  expect(encrypt).not.toHaveBeenCalled(); sender.destroy();
});
