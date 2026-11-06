// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { LoungeController } from '../../../../shared/lounge/controller';
import { historyKey, type LoungeHistoryStore } from '../../../../shared/lounge/archive';
import { mergeDelivery, needsDeliveryWork } from '../../../../shared/lounge/delivery';
import { INVALID_GROUP_RECEIPT } from '../../../../shared/lounge/groupReceipts';
import { parseMessage, type LoungeMessage } from '../../../../shared/lounge/types';

const reader = { id: 'reader', account: 'reader' };
const admin = { id: 'admin', account: 'admin', moderator: true };
const controllers: LoungeController[] = [];
const settle = async () => { for (let step = 0; step < 100; step++) await Promise.resolve(); };
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror = null;
  send = vi.fn(); close() {}
  constructor() { Socket.instances.push(this); }
  frame(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  ready() { this.frame({ type: 'ready', user: reader, direct: true, receipts: true, groupReads: true }); }
  reads() { return this.send.mock.calls.map(([frame]) => JSON.parse(frame)).filter(frame => frame.type === 'group-read'); }
}

afterEach(() => {
  controllers.splice(0).forEach(controller => controller.stop());
  Socket.instances = []; vi.unstubAllGlobals(); vi.useRealTimers();
});

it('persists single-receipt rejection through controller reconnect and restart', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
    const incoming: LoungeMessage = { type: 'message', id: 'historical', sender: admin,
      text: 'hello', images: [], sentAt: new Date().toISOString(), groupReceipt: 'old-signed-capability',
      delivery: { direction: 'incoming', status: 'read', confirmed: 'delivered', attemptedAt: Date.now() } };
    let saved = incoming;
    const history: LoungeHistoryStore = {
      save: async message => {
        saved = parseMessage(JSON.parse(JSON.stringify({ ...message,
          delivery: mergeDelivery(saved.delivery, message.delivery) })))!;
      },
      get: async key => key === historyKey(saved) ? saved : undefined,
      page: async query => ({ messages: !query.pendingOnly || needsDeliveryWork(saved.delivery) ? [saved] : [] }),
    };
    const start = async () => {
      const controller = new LoungeController({ baseUrl: 'https://lounge.test', account: reader.account, history,
        authorize: async () => ({ ticket: 'current-ticket' }) },
      { isVisible: () => true, subscribe: () => () => {}, randomId: () => crypto.randomUUID() });
      controllers.push(controller); controller.start(); await settle();
      const socket = Socket.instances.at(-1)!; socket.onopen?.(); socket.ready(); await settle();
      return { controller, socket };
    };
    const { controller, socket } = await start();
    await vi.advanceTimersByTimeAsync(6000); expect(socket.reads()).toHaveLength(1);
    // An unknown transient failure must not terminate a valid pending receipt.
    const rejected = { type: 'group-receipt-rejected', receiptType: 'group-read', id: incoming.id,
      from: admin.id, to: reader.id, groupReceipt: incoming.groupReceipt, code: 'temporarily-unavailable' };
    socket.frame(rejected); await settle();
    await vi.advanceTimersByTimeAsync(6000); expect(socket.reads()).toHaveLength(2);
    socket.frame({ ...rejected, code: INVALID_GROUP_RECEIPT }); await settle();
    expect(saved.delivery).toMatchObject({ status: 'read', confirmed: 'delivered',
      groupReceiptError: INVALID_GROUP_RECEIPT });
    expect(controller.snapshot().status).toBe('connected');
    socket.onclose?.(); await vi.advanceTimersByTimeAsync(10000); await settle();
    const reconnected = Socket.instances.at(-1)!;
    expect(reconnected).not.toBe(socket); reconnected.ready(); await settle();
    await vi.advanceTimersByTimeAsync(6000); expect(reconnected.reads()).toEqual([]);
    controller.stop();
    const restarted = await start();
    await vi.advanceTimersByTimeAsync(12000); expect(restarted.socket.reads()).toEqual([]);
    expect(restarted.controller.snapshot().messages[0]?.delivery?.groupReceiptError).toBe(INVALID_GROUP_RECEIPT);
  });
