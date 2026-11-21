import { afterEach, expect, it, vi } from 'vitest';
import { AttachmentExchange } from '../../../../shared/lounge/attachmentExchange';
import { ATTACHMENT_CHUNK_BYTES, attachmentByteLimit, checkAttachmentSize, parseAttachments,
  type AttachmentSource, type LoungeAttachment } from '../../../../shared/lounge/attachments';
import { DEFAULT_CHAT_POLICY, setChatPolicy } from '../../../../shared/remote-chat/policy';
import { hotLinkHarness } from '../remoteChat/hotLinkHarness';

const file: LoungeAttachment = { id: '10000000-0000-4000-8000-000000000001',
  device: '10000000-0000-4000-8000-000000000002', name: 'archive.zip', mime: 'application/zip',
  size: ATTACHMENT_CHUNK_BYTES * 4 + 7, kind: 'file', grant: 'signed' };
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.useRealTimers(); });

it('uses separate group/private image limits and accepts the exact default 300 MB file boundary', () => {
  expect(attachmentByteLimit('file', true)).toBe(300 * 1024 * 1024);
  expect(() => checkAttachmentSize({ size: 300 * 1024 * 1024 }, 'file', 'peer')).not.toThrow();
  expect(() => checkAttachmentSize({ size: 300 * 1024 * 1024 + 1 }, 'file', 'peer')).toThrow();
  expect(() => checkAttachmentSize({ size: 1 }, 'file')).toThrow();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, loungeGroupImageMaxMb: 2, loungeDirectImageMaxMb: 5 });
  expect(attachmentByteLimit('image', false)).toBe(2 * 1024 * 1024);
  expect(attachmentByteLimit('image', true)).toBe(5 * 1024 * 1024);
  expect(parseAttachments([{ ...file, size: -1 }])).toBeUndefined();
  expect(parseAttachments([{ ...file, name: '../secret' }])).toBeUndefined();
  for (const name of ['.', '..', 'bad\tname', 'bad\u007fname']) {
    expect(parseAttachments([{ ...file, name }])).toBeUndefined();
  }
});

it('streams ordered bounded chunks through relay, P2P, and relay recovery without duplicate bytes', async () => {
  vi.useFakeTimers();
  const content = Buffer.alloc(file.size, 173);
  const received: Buffer[] = [];
  const exchanges = {} as Record<'phone' | 'pc', AttachmentExchange>;
  const harness = hotLinkHarness({ startOnRelay: true, onMessage: (side, message) => exchanges[side].receive(message) });
  const reads: number[] = [];
  exchanges.pc = new AttachmentExchange({ fileId: file.id,
    source: () => ({ ...file, read: async (offset, length) => {
      reads.push(offset); return content.subarray(offset, offset + length).toString('base64');
    } }), send: message => harness.links.pc.send(message) });
  exchanges.phone = new AttachmentExchange({ fileId: file.id, source: () => undefined,
    send: message => harness.links.phone.send(message) });
  const abort = vi.fn();
  let completed = false;
  harness.paths.direct = false;
  try {
    const result = exchanges.phone.download(file, {
      write: async data => {
        received.push(Buffer.from(data, 'base64'));
        if (received.length === 1) {
          harness.paths.direct = true;
          await new Promise(resolve => setTimeout(resolve, 4500));
        }
        if (received.length === 2) harness.paths.direct = false;
      }, finish: async () => { completed = true; return 'saved'; }, abort,
    });
    for (let step = 0; step < 40 && !completed; step++) await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe('saved');
    expect(Buffer.concat(received)).toEqual(content);
    expect(reads).toEqual([0, 1, 2, 3, 4].map(n => n * ATTACHMENT_CHUNK_BYTES));
    const paths = harness.packets.filter(packet => packet.frame.kind === 'data').map(packet => packet.path);
    expect(paths[0]).toBe('relay'); expect(paths).toContain('direct'); expect(paths.at(-1)).toBe('relay');
    expect(harness.packets.some(packet => packet.path === 'relay' && packet.frame.kind === 'ping')).toBe(true);
    expect(abort).not.toHaveBeenCalled(); expect(harness.error).not.toHaveBeenCalled();
  } finally { exchanges.pc.close(); exchanges.phone.close(); harness.close(); }
});

it('queues the next range while a previous response acknowledgement is still in flight', async () => {
  const content = Buffer.alloc(file.size, 42), chunks: Buffer[] = [];
  let source: AttachmentExchange, target: AttachmentExchange;
  // Once the sender accepts the peer, deleting the conversation must not interrupt this download.
  const readSource = vi.fn<() => AttachmentSource | undefined>().mockReturnValueOnce({ ...file,
    read: async (offset, length) => content.subarray(offset, offset + length).toString('base64') });
  source = new AttachmentExchange({ fileId: file.id, source: readSource,
    send: async message => { target.receive(message); await new Promise(resolve => setTimeout(resolve, 1)); } });
  source.claimSource();
  expect(readSource).toHaveBeenCalledOnce();
  target = new AttachmentExchange({ fileId: file.id, source: () => undefined,
    send: async message => { source.receive(message); } });
  try {
    await target.download(file, { write: async data => { chunks.push(Buffer.from(data, 'base64')); },
      finish: async () => '', abort: vi.fn() });
    expect(Buffer.concat(chunks)).toEqual(content);
    expect(readSource).toHaveBeenCalledOnce();
  } finally { source.close(); target.close(); }
});

it('rejects truncated chunks and cleans up the partial file', async () => {
  let target: AttachmentExchange;
  target = new AttachmentExchange({ fileId: file.id, source: () => undefined, send: async message => {
    if (message.kind === 'request') target.receive({ kind: 'response', id: message.id, data: 'YQ==' });
  } });
  const sink = { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
  await expect(target.download(file, sink)).rejects.toThrow();
  expect(sink.abort).toHaveBeenCalledOnce(); expect(sink.write).not.toHaveBeenCalled(); target.close();
});

it('cancels an in-flight request without publishing a partial file', async () => {
  const requested = vi.fn(async () => {});
  const target = new AttachmentExchange({ fileId: file.id, source: () => undefined, send: requested });
  const sink = { write: vi.fn(), finish: vi.fn(), abort: vi.fn() };
  const abort = new AbortController();
  const result = target.download(file, sink, { signal: abort.signal });
  const rejected = expect(result).rejects.toThrow();
  expect(requested).toHaveBeenCalledOnce();
  abort.abort(); await rejected;
  expect(sink.abort).toHaveBeenCalledOnce(); expect(sink.finish).not.toHaveBeenCalled();
  target.close();
});
