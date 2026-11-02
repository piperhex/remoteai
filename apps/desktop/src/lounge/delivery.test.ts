import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoungeDirectDelivery } from '../../../../shared/lounge/directDelivery';
import { historyKey, historyPage } from '../../../../shared/lounge/archive';
import { mergeDelivery, needsDeliveryWork } from '../../../../shared/lounge/delivery';
import type { LoungeAccount, LoungeMessage } from '../../../../shared/lounge/types';

const alice = { id: 'alice', account: 'alice@example.test' };
const bob = { id: 'bob', account: 'bob@example.test' };
const instances: LoungeDirectDelivery[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T00:00:00Z')); });
afterEach(() => { instances.forEach(instance => instance.stop()); instances.length = 0; vi.useRealTimers(); });
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function fixture(self: LoungeAccount = alice, rows = new Map<string, LoungeMessage>()) {
  const state = { online: true, readable: false, connected: true, allowed: true };
  const fresh: LoungeMessage[] = [];
  const transmit = vi.fn<(frame: Record<string, unknown>) => boolean>(() => true);
  const engine = new LoungeDirectDelivery({ self: () => self, enabled: () => state.connected,
    online: () => state.online, readable: () => state.readable, allowed: () => state.allowed,
    find: async key => rows.get(key), page: async query => historyPage(
      [...rows.values()].filter(message => needsDeliveryWork(message.delivery)), query),
    publish: async (message, isNew) => { rows.set(historyKey(message), message); if (isNew) fresh.push(message); },
    transmit, error: () => { throw new Error('Unexpected delivery storage failure'); },
  });
  instances.push(engine); engine.start();
  return { engine, state, transmit, rows, fresh };
}
const message = (): LoungeMessage => ({ type: 'message', id: 'one', text: 'hello', images: [], sender: alice,
  recipient: bob, receipts: true, conversation: 'alice', sentAt: new Date().toISOString() });

it('does not revive a rejected opening from a stale write by another window', () => {
  const merged = mergeDelivery({ direction: 'outgoing', status: 'rejected', retry: false },
    { direction: 'outgoing', status: 'pending', retry: true });
  expect(merged?.status).toBe('rejected');
  expect(needsDeliveryWork(merged)).toBe(false);
});

it('keeps avatars in local history but omits them from private sends and retries', async () => {
  const avatar = 'data:image/png;base64,AAAA';
  const { engine, transmit, rows } = fixture({ ...alice, avatar });
  await engine.send({ text: 'hello', images: [], to: bob.id }, 'cached', bob);
  await vi.advanceTimersByTimeAsync(6000);
  expect(transmit.mock.calls.length).toBeGreaterThan(1);
  for (const [frame] of transmit.mock.calls) expect(frame).not.toHaveProperty('avatar');
  expect(rows.get('["alice","cached"]')?.sender.avatar).toBe(avatar);
});

it('retries the same message after five seconds only while the peer is online, until a client receipt arrives', async () => {
  const { engine, state, transmit, rows } = fixture();
  await engine.send({ text: 'hello', images: [], to: bob.id }, 'one', bob);
  expect(rows.get('["alice","one"]')?.delivery?.status).toBe('pending');
  await vi.advanceTimersByTimeAsync(4999); expect(transmit).toHaveBeenCalledTimes(1);
  state.online = false; await vi.advanceTimersByTimeAsync(10_001); expect(transmit).toHaveBeenCalledTimes(1);
  state.online = true; await vi.advanceTimersByTimeAsync(1000); expect(transmit).toHaveBeenCalledTimes(2);
  expect(transmit.mock.calls[0]).toEqual(transmit.mock.calls[1]);
  engine.receipt({ type: 'receipt', id: 'one', from: 'stranger', to: 'alice', status: 'read' }); await settle();
  expect(rows.get('["alice","one"]')?.delivery?.status).toBe('pending');
  engine.receipt({ type: 'receipt', id: 'one', from: 'bob', to: 'alice', status: 'delivered' }); await settle();
  expect(rows.get('["alice","one"]')?.delivery?.status).toBe('delivered');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(transmit.mock.calls.filter(([frame]) => frame.type === 'message')).toHaveLength(2);
  engine.receipt({ type: 'receipt', id: 'one', from: 'bob', to: 'alice', status: 'read' }); await settle();
  engine.receipt({ type: 'receipt', id: 'one', from: 'bob', to: 'alice', status: 'delivered' }); await settle();
  expect(rows.get('["alice","one"]')?.delivery?.status).toBe('read');
});

it('deduplicates durable received messages and retries a lost read receipt after restart until confirmed', async () => {
  const first = fixture(bob); first.engine.receive(message()); await settle();
  expect(first.fresh).toHaveLength(1);
  expect(first.transmit).toHaveBeenLastCalledWith({ type: 'receipt', id: 'one', to: 'alice', status: 'delivered' });
  first.state.readable = true; first.engine.read([...first.rows.values()]); await settle();
  first.engine.stop();
  const restored = fixture(bob, first.rows); await settle();
  await vi.advanceTimersByTimeAsync(5000);
  expect(restored.transmit).toHaveBeenLastCalledWith({ type: 'receipt', id: 'one', to: 'alice', status: 'read' });
  restored.engine.receive({ ...message(), text: 'must not replace the original' }); await settle();
  expect(restored.fresh).toHaveLength(0);
  expect(restored.rows.get('["alice","one"]')?.text).toBe('hello');
  restored.engine.receipt({ type: 'receipt-confirm', id: 'one', from: 'alice', to: 'bob', status: 'read' });
  await settle(); const count = restored.transmit.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000); expect(restored.transmit).toHaveBeenCalledTimes(count);
  expect(restored.rows.get('["alice","one"]')?.delivery?.confirmed).toBe('read');
});

it('restores the sender outbox, pauses on disconnect or mute and cancels jobs on sign out', async () => {
  const first = fixture(); await first.engine.send({ text: 'queued', images: [] }, 'one', bob); first.engine.stop();
  const restored = fixture(alice, first.rows); restored.state.connected = false; await settle();
  await vi.advanceTimersByTimeAsync(10_000); expect(restored.transmit).not.toHaveBeenCalled();
  restored.state.connected = true; restored.state.allowed = false;
  await vi.advanceTimersByTimeAsync(10_000); expect(restored.transmit).not.toHaveBeenCalled();
  restored.state.allowed = true; await vi.advanceTimersByTimeAsync(1000);
  expect(restored.transmit).toHaveBeenCalledTimes(1);
  restored.engine.stop(); await vi.advanceTimersByTimeAsync(10_000); expect(restored.transmit).toHaveBeenCalledTimes(1);
});
