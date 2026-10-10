import { guiText } from "../../../i18n/guiText";
import { Channel, invoke } from '@tauri-apps/api/core';
import type { ChatSocket } from '../../../../../../shared/remote-chat/client/socket';
import type { GuiCloudIdentity } from './types';
import { decodeGuiBulkBatch } from './nativeBulkSocket';

type SocketEvent = { type: 'message'; data: string } | { type: 'closed'; code: number };
interface Batch { sequence: number; events: SocketEvent[] }
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
let lifecycle = Promise.resolve();

/** Peer frames and connection diagnostics cross IPC; Rust adds cloud authentication. */
export class NativeGuiSocket implements ChatSocket {
  readonly clientId = crypto.randomUUID();
  readyState = 0;
  bufferedAmount = 0;
  bulkAvailable = false;
  onbulk: ChatSocket['onbulk'] = null;
  onopen: ChatSocket['onopen'] = null;
  onmessage: ChatSocket['onmessage'] = null;
  onclose: ChatSocket['onclose'] = null;
  onerror: ChatSocket['onerror'] = null;
  private started?: Promise<void>;
  private outgoing = Promise.resolve();
  private readonly channel = new Channel<Batch>();
  private readonly bulkChannel = new Channel<ArrayBuffer>();

  constructor(private readonly identity: GuiCloudIdentity, private readonly assistanceId?: string) {
    this.channel.onmessage = (batch) => this.deliver(batch);
    this.bulkChannel.onmessage = (batch) => this.deliverBulk(batch);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
    });
  }

  private deliver(batch: Batch) {
    if (this.readyState !== 1) return;
    try {
      for (const event of batch.events) {
        if (this.readyState !== 1) break;
        if (event.type === 'closed') this.finish(event.code);
        else {
          const frame = JSON.parse(event.data) as { type?: string; fileBulkV1?: boolean };
          if (frame.type === 'chat-policy') this.bulkAvailable = frame.fileBulkV1 === true;
          this.onmessage?.({ data: event.data });
        }
      }
    } catch { this.finish(1006); } finally {
      if (batch.sequence) void invoke('gui_remote_ack', {
        request: { clientId: this.clientId, sequence: batch.sequence },
      }).catch(() => this.finish(1006));
    }
  }

  private deliverBulk(data: ArrayBuffer) {
    if (this.readyState !== 1) return;
    try {
      if (!this.bulkAvailable) throw new Error('Bulk not negotiated');
      const { sequence, records } = decodeGuiBulkBatch(data);
      for (const { sessionId, record } of records) {
        if (this.readyState !== 1) break;
        this.onbulk?.(sessionId, record);
      }
      void invoke('gui_remote_ack', { request: { clientId: this.clientId, sequence, bulk: true } })
        .catch(() => this.finish(1006));
    } catch { this.finish(1006); }
  }

  send(data: string) {
    if (this.readyState !== 1) throw new Error(guiText("连接已断开，请重新连接。"));
    const frame = JSON.parse(data) as Record<string, unknown>;
    if (!this.started) {
      if (frame.type !== 'authenticate') throw new Error(guiText("请先连接电脑。"));
      this.started = lifecycle.then(async () => {
        if (this.readyState === 1) await invoke('gui_remote_open', { request: { clientId: this.clientId,
          deviceId: frame.deviceId, publicKey: frame.publicKey, resume: frame.resume, identity: this.identity,
          ...(this.assistanceId ? { assistanceId: this.assistanceId } : {}),
          bulkEvents: this.bulkChannel },
          events: this.channel });
      });
      lifecycle = this.started.catch(() => undefined);
      this.outgoing = this.started.catch(() => this.finish(1006));
      return;
    }
    const bytes = new TextEncoder().encode(data).length;
    if (this.bufferedAmount + bytes > MAX_BUFFER_BYTES) throw new Error(guiText("连接繁忙，请稍后重试。"));
    this.bufferedAmount += bytes;
    this.outgoing = this.outgoing.then(async () => {
      await invoke('gui_remote_send', { request: { clientId: this.clientId, message: frame } });
    }).catch(() => {
      // Diagnostic delivery must not end an otherwise healthy chat session.
      if (frame.type !== 'diagnostic') this.finish(1006);
    }).finally(() => { this.bufferedAmount -= bytes; });
  }

  private finish(code: number) {
    if (this.readyState === 3) return;
    this.close();
    this.onclose?.({ code });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.bulkAvailable = false;
    // Drain peer-close before replacing this socket, otherwise abandoned sessions occupy the host's slots.
    if (this.started) lifecycle = Promise.all([lifecycle, this.outgoing]).then(() => invoke<void>('gui_remote_close', {
      request: { clientId: this.clientId },
    })).catch(() => { /* The native worker also exits when its event channel or cloud login expires. */ });
  }
}
