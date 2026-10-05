import { expect, it, vi } from 'vitest';
import { BulkTransport, type BinaryChannel } from '../../../../shared/remote-chat/bulkTransport';
import { BulkCipher } from '../../../../shared/remote-chat/bulkCipher';

function channel() {
  let closed = () => {};
  const value: BinaryChannel = { readyState: 'open', bufferedAmount: 0, send: vi.fn(),
    close: vi.fn(() => closed()), onMessage() {}, onLow: () => () => {}, onClose: callback => { closed = callback; } };
  return value;
}

function fixture() {
  const context = { transferId: crypto.randomUUID(), epoch: crypto.randomUUID(), manifestId: 'f'.repeat(64),
    desktopKey: 'host', clientKey: 'viewer', sessionId: 'session', desktop: true };
  const cipher = new BulkCipher(new Uint8Array(32).fill(8), context);
  const record = cipher.encrypt({ requestId: crypto.randomUUID(), block: 0, offset: 0 }, Uint8Array.of(7));
  const relay = { available: () => true, send: vi.fn(async () => {}) };
  const transport = new BulkTransport(relay);
  transport.setMode('relay');
  const receive = vi.fn(), failed = vi.fn(), invalidated = vi.fn();
  transport.listen(context.transferId, { epoch: context.epoch, path: 'relay', record: receive, failed });
  transport.onInvalidated(invalidated);
  return { transport, record, relay, receive, failed, invalidated };
}

it('keeps a live relay transfer when background direct attempts attach, replace and close', async () => {
  const test = fixture(); const first = channel(), second = channel();
  test.transport.attach(first); test.transport.attach(second); second.close();
  test.transport.receive(test.record, 'relay');
  await test.transport.send(test.record, 'relay', new AbortController().signal);
  expect(test.invalidated).not.toHaveBeenCalled();
  expect(test.failed).not.toHaveBeenCalled();
  expect(test.receive).toHaveBeenCalledWith(test.record);
  expect(test.relay.send).toHaveBeenCalledWith(test.record);
});

it('fences selected direct channels exactly once and ignores closure of an obsolete channel', () => {
  const test = fixture(); const first = channel(), second = channel();
  test.transport.attach(first); test.transport.setMode('direct'); test.invalidated.mockClear();
  test.transport.attach(first);
  expect(first.close).not.toHaveBeenCalled();
  expect(test.invalidated).not.toHaveBeenCalled();
  test.transport.attach(second);
  expect(test.invalidated).toHaveBeenCalledTimes(1);
  first.close();
  expect(test.invalidated).toHaveBeenCalledTimes(1);
  second.close();
  expect(test.invalidated).toHaveBeenCalledTimes(2);
});

it('does not replay a queued batch after the path leaves and returns to relay', async () => {
  const test = fixture();
  let finish = () => {};
  test.relay.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const signal = new AbortController().signal;
  const first = test.transport.send(test.record, 'relay', signal);
  await Promise.resolve();
  const queued = test.transport.sendBatch([test.record, test.record], 'relay', signal);
  const rejected = expect(queued).rejects.toMatchObject({ code: 'PATH_UNAVAILABLE' });
  test.transport.setMode('direct'); test.transport.setMode('relay'); finish();
  await first; await rejected;
  expect(test.relay.send).toHaveBeenCalledTimes(1);
});

it('validates the entire batch and its memory bound before forwarding any records', async () => {
  const test = fixture(); const signal = new AbortController().signal;
  await expect(test.transport.sendBatch([test.record, new Uint8Array(2)], 'relay', signal)).rejects.toThrow();
  await expect(test.transport.sendBatch(Array.from({ length: 17 }, () => test.record), 'relay', signal))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(test.relay.send).not.toHaveBeenCalled();
});
