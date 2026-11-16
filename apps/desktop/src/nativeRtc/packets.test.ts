import { expect, it } from 'vitest';
import { readNativePackets } from './packets';

function packet(key: string, bytes: number[]) {
  const header = new TextEncoder().encode(JSON.stringify({ kind: 'data', key }));
  const result = new Uint8Array(8 + header.length + bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, header.length); view.setUint32(4, bytes.length);
  result.set(header, 8); result.set(bytes, 8 + header.length); return result;
}

it('preserves record boundaries and order when batching multiple channels', () => {
  const a = packet('first', [1, 2]), b = packet('second', [3]);
  const batch = new Uint8Array(a.length + b.length); batch.set(a); batch.set(b, a.length);
  const received: unknown[] = [];
  readNativePackets(batch.buffer, (header, bytes) => received.push([header, [...bytes]]));
  expect(received).toEqual([[{ kind: 'data', key: 'first' }, [1, 2]], [{ kind: 'data', key: 'second' }, [3]]]);
});

it('rejects truncated framing and payloads without delivering incomplete records', () => {
  const record = packet('first', [1, 2]);
  for (const size of [1, 7, record.length - 1]) {
    expect(() => readNativePackets(record.buffer.slice(0, size), () => { throw new Error('Delivered partial'); }))
      .toThrow(/native RTC packet/);
  }
});
