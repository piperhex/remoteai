import { afterEach, expect, it, vi } from 'vitest';
import { hotLinkHarness } from './hotLinkHarness';
import { testPacketCompression } from './compressionTestCodec';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import { transferFileChunks, FILE_CHUNK_BYTES } from '../../../../shared/remote-chat/fileDownload';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../shared/remote-chat/policy';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); setChatPolicy(DEFAULT_CHAT_POLICY); });

it.each(['direct', 'relay'] as const)('keeps chat connected during concurrent %s downloads', async mode => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  let rpc: ChatRpc;
  const failures: unknown[] = [];
  const compression = () => {
    const codec = testPacketCompression()!;
    let decoded = 0;
    return { ...codec, decompress: async (bytes: Uint8Array, length: number) => {
      await new Promise(resolve => setTimeout(resolve, ++decoded % 7 === 0 ? 100 : 1));
      return codec.decompress(bytes, length);
    } };
  };
  const harness = hotLinkHarness({ compression: { pc: compression, phone: compression }, onMessage: (side, message) => {
    if (side === 'phone') { rpc.receive(message); return; }
    if (message.kind !== 'request') return;
    const body = message.body as { offset: number; length: number };
    void harness.links.pc.send({ kind: 'response', id: message.id,
      data: { offset: body.offset, data: Buffer.alloc(body.length, body.offset % 251).toString('base64') },
    }).catch(error => failures.push(error));
  } });
  if (mode === 'relay') harness.paths.direct = false;
  rpc = new ChatRpc({ prefix: 'download', send: message => harness.links.phone.send(message), event: () => {} });
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.links.phone.connectionMode).toBe(mode);
    const size = FILE_CHUNK_BYTES * 48;
    let written = 0, finished = false;
    const downloads = Promise.all(Array.from({ length: 2 }, (_, index) => transferFileChunks({
      client: { read: request => rpc.request('request', request) }, threadId: String(index),
      info: { id: crypto.randomUUID(), name: 'file.bin', mimeType: 'application/octet-stream', size },
      signal: new AbortController().signal, mode: () => mode,
      write: async chunk => { written += Buffer.from(chunk.data, 'base64').length; },
    }))).then(() => { finished = true; }, error => { failures.push(error); finished = true; });
    for (let tick = 0; tick < 800 && !finished; tick++) await vi.advanceTimersByTimeAsync(250);
    expect(failures).toEqual([]);
    expect(harness.error).not.toHaveBeenCalled();
    expect(written).toBe(size * 2);
    await downloads;
  } finally { rpc.close(); harness.close(); }
}, 60_000);

it.each(['direct', 'relay'] as const)('keeps %s downloads connected when final fragments arrive late', async mode => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const harness = hotLinkHarness();
  if (mode === 'relay') harness.paths.direct = false;
  const failures: unknown[] = [];
  try {
    await vi.advanceTimersByTimeAsync(5000);
    harness.filter(packet => {
      if (packet.side !== 'pc' || packet.frame.kind !== 'data') return true;
      const part = JSON.parse(String(packet.frame.text)) as { id: string; index: number; total: number };
      return !(part.id.match(/^responses:[1-4]$/) && part.index === part.total - 1);
    });
    for (let index = 0; index < 10; index++) {
      void harness.links.pc.send({ kind: 'response', id: `file:${index}`,
        data: Buffer.alloc(FILE_CHUNK_BYTES).toString('base64') }).catch(error => failures.push(error));
    }
    await vi.advanceTimersByTimeAsync(100);
    const event = { kind: 'event' as const, event: { text: 'live chat' } };
    void harness.links.pc.send(event).catch(error => failures.push(error));
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.error).not.toHaveBeenCalled();
    expect(harness.messages.phone).toEqual([event]);
    harness.filter(() => true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.error).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
    expect(harness.messages.phone).toHaveLength(11);
    expect(harness.messages.phone.slice(1)).toEqual(expect.arrayContaining(
      Array.from({ length: 10 }, (_, index) => ({ kind: 'response', id: `file:${index}`,
        data: Buffer.alloc(FILE_CHUNK_BYTES).toString('base64') }))));
  } finally { harness.close(); }
}, 30_000);
