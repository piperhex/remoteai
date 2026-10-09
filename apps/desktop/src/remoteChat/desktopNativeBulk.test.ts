import { afterEach, expect, it, vi } from 'vitest';
import { createDesktopNativePath } from './nativePath';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';
import { BulkTransport } from '../../../../shared/remote-chat/bulkTransport';
import { encodeNativeBulkBatch } from '../../../../shared/remote-chat/nativeBulkChannel';
import type { NativePathEvent } from '../../../../shared/remote-chat/nativePath';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), event: (_event: NativePathEvent) => {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class {
  set onmessage(callback: (event: NativePathEvent) => void) { mocks.event = callback; }
} }));

afterEach(() => { vi.clearAllMocks(); });

it('delivers desktop native P2P file bytes while keeping control events responsive and reads single-flight', async () => {
  const transferId = crypto.randomUUID(), epoch = crypto.randomUUID();
  const cipher = new BulkCipher(new Uint8Array(32).fill(9), { transferId, epoch,
    manifestId: 'c'.repeat(64), sessionId: 'session', desktopKey: 'host', clientKey: 'viewer', desktop: true });
  const bytes = cipher.encrypt({ requestId: crypto.randomUUID(), block: 0, offset: 0 }, Uint8Array.of(1, 2, 3));
  cipher.destroy();
  let reply: ((data: ArrayBuffer) => void) | undefined;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'remote_native_path_open') return 'handle';
    if (command === 'remote_native_bulk_receive') return new Promise<ArrayBuffer>(resolve => { reply = resolve; });
  });
  const bulk = new BulkTransport(); bulk.setMode('direct');
  const path = createDesktopNativePath({ sessionId: 'session', desktop: false,
    config: { secret: 'ab'.repeat(32), servers: [], stunServers: [], expiresAt: 100_000 },
    bulkChannel: (channel, source) => bulk.attach(channel, source) });
  const messages = vi.fn(), received = vi.fn(); path.onMessage(messages);
  try {
    mocks.event({ type: 'open' }); mocks.event({ type: 'bulk', generation: 1 });
    bulk.listen(transferId, { epoch, path: 'direct', record: received, failed: vi.fn() });
    await vi.waitFor(() => expect(reply).toBeDefined());
    mocks.event({ type: 'data', text: 'chat still works' });
    expect(messages).toHaveBeenCalledWith('chat still works');
    reply!(encodeNativeBulkBatch([bytes, bytes]).buffer);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
    expect(received).toHaveBeenLastCalledWith(bytes);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'remote_native_bulk_receive')).toHaveLength(2);
    path.close();
    reply!(encodeNativeBulkBatch([bytes]).buffer);
    await Promise.resolve(); await Promise.resolve();
    expect(received).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'remote_native_bulk_receive')).toHaveLength(2);
  } finally { path.close(); bulk.close(); }
});
