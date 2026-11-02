import { historyKey, type HistoryPage, type HistoryQuery } from './archive';
import { DIRECT_RETRY_MS, isReceiptStatus, needsDeliveryWork, receiptRank, type ReceiptStatus } from './delivery';
import type { LoungeAccount, LoungeDraft, LoungeMessage } from './types';
import { AWAITING_REPLY, checkDirectPermission, type DirectPermission } from './directPermission';

interface DeliveryHost {
  self(): LoungeAccount | undefined;
  enabled(): boolean;
  online(id: string): boolean;
  readable(message: LoungeMessage): boolean;
  allowed(message: LoungeMessage): boolean;
  find(key: string): Promise<LoungeMessage | undefined>;
  page(query: HistoryQuery): Promise<HistoryPage>;
  publish(message: LoungeMessage, fresh: boolean): Promise<void>;
  transmit(frame: Record<string, unknown>): boolean;
  error(): void;
  permission?(peer: string): DirectPermission | undefined;
  generation?(peer: string): number;
  ready?(peer: string): boolean;
}
interface DeliveryJob { peer: string; due: number }

/** Endpoint-owned delivery state. Jobs retain keys only; image payloads stay in the local archive. */
export class LoungeDirectDelivery {
  private jobs = new Map<string, DeliveryJob>();
  private tasks: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private active = false;
  private ticking = false;

  constructor(private readonly host: DeliveryHost) {}

  start() {
    this.active = true; this.generation++;
    this.background(async current => {
      let before: HistoryQuery['before'];
      do {
        const page = await this.host.page({ query: '', pendingOnly: true, before });
        if (!current()) return;
        for (const message of page.messages) this.track(message);
        before = page.next;
      } while (before);
    });
    this.timer = setInterval(() => {
      if (this.ticking || !this.host.enabled()) return;
      this.ticking = true;
      this.background(current => this.retry(current).finally(() => { this.ticking = false; }));
    }, 1000);
  }
  stop() {
    this.active = false; this.generation++;
    clearInterval(this.timer); this.jobs.clear(); this.ticking = false;
  }
  peers() { return [...new Set([...this.jobs.values()].map(job => job.peer))]; }

  remove(peer: string, erase: () => Promise<void>) {
    return this.run(async () => {
      await erase();
      for (const [key, job] of this.jobs) if (job.peer === peer && !await this.host.find(key)) this.jobs.delete(key);
      return true;
    }).then(removed => { if (!removed) throw new Error('client.lounge.deleteFailed'); });
  }

  private run<T>(operation: (current: () => boolean) => Promise<T>) {
    const generation = this.generation;
    const current = () => this.active && generation === this.generation;
    const result = this.tasks.then(async () => { if (current()) return operation(current); });
    // Keep later jobs runnable; the operation's caller still receives its rejection.
    this.tasks = result.catch(() => {});
    return result;
  }
  private background(operation: (current: () => boolean) => Promise<void>) {
    void this.run(operation).catch(() => this.host.error());
  }
  private track(message: LoungeMessage) {
    const key = historyKey(message);
    if (!message.recipient || !needsDeliveryWork(message.delivery)) { this.jobs.delete(key); return; }
    this.jobs.set(key, { peer: message.delivery?.direction === 'incoming' ? message.sender.id : message.recipient.id,
      due: (message.delivery?.attemptedAt ?? 0) + DIRECT_RETRY_MS });
  }

  async send(draft: LoungeDraft, id: string, recipient: LoungeAccount) {
    const sender = this.host.self();
    if (!sender || !this.host.enabled() || this.host.ready?.(recipient.id) === false) {
      throw new Error('client.lounge.directUnavailable');
    }
    await this.run(async current => {
      await checkDirectPermission({ self: sender.id, peer: recipient.id,
        permission: this.host.permission?.(recipient.id), generation: this.host.generation?.(recipient.id),
        page: query => this.host.page(query) });
      if (!current()) return;
      const message: LoungeMessage = { type: 'message', id, sender, recipient, text: draft.text,
        attachments: draft.attachments,
        images: draft.images, reply: draft.reply, sentAt: new Date().toISOString(), conversation: recipient.id,
        generation: this.host.generation?.(recipient.id),
        receipts: true, delivery: { direction: 'outgoing', status: 'pending', retry: true, attemptedAt: Date.now() } };
      await this.host.publish(message, true);
      if (!current()) return;
      this.track(message); this.transmitMessage(message);
    });
  }

  reject(frame: Record<string, unknown>) {
    if (![AWAITING_REPLY, 'client.lounge.conversationReset', 'client.lounge.attachmentLimit'].includes(String(frame.code))
      || typeof frame.id !== 'string' || !this.host.self()) return;
    const key = JSON.stringify([this.host.self()!.id, frame.id]);
    this.background(async current => {
      const saved = await this.host.find(key);
      if (!current() || saved?.delivery?.direction !== 'outgoing' || saved.delivery.status !== 'pending') return;
      const message: LoungeMessage = { ...saved, delivery: { ...saved.delivery, status: 'rejected', retry: false } };
      await this.host.publish(message, false);
      if (current()) this.track(message);
    });
  }

  receive(message: LoungeMessage) {
    this.background(async current => {
      const previous = await this.host.find(historyKey(message));
      if (!current()) return;
      if (message.sender.id === this.host.self()?.id) {
        if (previous && message.attachments?.length) {
          await this.host.publish({ ...previous, attachments: message.attachments }, false);
        }
        if (!previous) await this.host.publish({ ...message,
          delivery: { direction: 'outgoing', status: 'pending' } }, true);
        return;
      }
      const received = previous ?? { ...message, delivery: { direction: 'incoming' as const, status: 'delivered' as const } };
      if (!received.delivery || !this.host.allowed(received)) return;
      const status = received.delivery.status === 'read' || this.host.readable(received) ? 'read' : 'delivered';
      const updated: LoungeMessage = { ...received, delivery: { ...received.delivery, status, attemptedAt: Date.now() } };
      await this.host.publish(updated, !previous);
      if (!current()) return;
      this.track(updated); this.transmitReceipt(updated);
    });
  }

  read(messages: LoungeMessage[]) {
    this.background(async current => {
      for (const candidate of messages) {
        if (candidate.delivery?.direction !== 'incoming' || candidate.delivery.status === 'read') continue;
        const saved = await this.host.find(historyKey(candidate));
        if (!current()) return;
        if (!saved?.delivery || saved.delivery.status === 'read'
          || !this.host.readable(saved) || !this.host.allowed(saved)) continue;
        const message: LoungeMessage = { ...saved,
          delivery: { ...saved.delivery, status: 'read', attemptedAt: Date.now() } };
        await this.host.publish(message, false);
        if (!current()) return;
        this.track(message); this.transmitReceipt(message);
      }
    });
  }

  receipt(frame: Record<string, unknown>) {
    if (typeof frame.id !== 'string' || typeof frame.from !== 'string' || !isReceiptStatus(frame.status)
      || frame.to !== this.host.self()?.id) return;
    const id = frame.id; const from = frame.from; const status = frame.status;
    const confirmation = frame.type === 'receipt-confirm';
    const key = JSON.stringify([confirmation ? from : this.host.self()!.id, id]);
    this.background(async current => {
      const saved = await this.host.find(key);
      if (!current() || !saved?.delivery || !saved.receipts) return;
      const peer = confirmation ? saved.sender.id : saved.recipient?.id;
      if (peer !== from || saved.delivery.direction !== (confirmation ? 'incoming' : 'outgoing')) return;
      if (confirmation && receiptRank(status) > receiptRank(saved.delivery.status)) return;
      const delivery = confirmation
        ? { ...saved.delivery, confirmed: higherReceipt(saved.delivery.confirmed, status) }
        : { ...saved.delivery, status: higherReceipt(saved.delivery.status, status) };
      const message = { ...saved, delivery };
      await this.host.publish(message, false);
      if (!current()) return;
      this.track(message);
      if (!confirmation) this.host.transmit({ type: 'receipt-confirm', id, to: from, status });
    });
  }

  private async retry(current: () => boolean) {
    for (const [key, job] of this.jobs) {
      if (!current() || !this.host.enabled()) return;
      if (job.due > Date.now() || !this.host.online(job.peer)) continue;
      const saved = await this.host.find(key);
      if (!current()) return;
      if (!saved?.delivery || !needsDeliveryWork(saved.delivery)) { this.jobs.delete(key); continue; }
      if (!this.host.allowed(saved)) continue;
      const message = { ...saved, delivery: { ...saved.delivery, attemptedAt: Date.now() } };
      await this.host.publish(message, false);
      if (!current()) return;
      this.track(message);
      if (message.delivery.direction === 'outgoing') this.transmitMessage(message);
      else this.transmitReceipt(message);
    }
  }
  private transmitMessage(message: LoungeMessage) {
    this.host.transmit({ type: 'message', id: message.id, to: message.recipient!.id, receipts: true,
      text: message.text, images: message.images, attachments: message.attachments,
      reply: message.reply,
      generation: message.generation ?? 0 });
  }
  private transmitReceipt(message: LoungeMessage) {
    if (message.delivery?.status === 'pending') return;
    this.host.transmit({ type: 'receipt', id: message.id, to: message.sender.id, status: message.delivery?.status });
  }
}

function higherReceipt(previous: string | undefined, incoming: ReceiptStatus): ReceiptStatus {
  return receiptRank(previous) > receiptRank(incoming) ? 'read' : incoming;
}
