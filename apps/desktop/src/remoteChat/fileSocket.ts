import { Channel, invoke } from '@tauri-apps/api/core';
import type { ChatSocket } from '../../../../shared/remote-chat/client/socket';
import { decodeGuiBulkBatch } from '../../../../shared/remote-chat/nativeRelayBatch';
import { encodeBulkIpc } from './bulkIpc';

interface Batch { sequence: number; events: ({ type: 'message'; data: string } | { type: 'closed'; code: number })[] }
const MAX_FILE_BUFFER_BYTES = 512 * 1024;

/** Rust supplies the configured cloud endpoint and proxy; this adapter carries only file capabilities and bytes. */
export class NativeFileSocket implements ChatSocket {
  private readonly clientId = crypto.randomUUID();
  private readonly events = new Channel<Batch>();
  private readonly bulkEvents = new Channel<ArrayBuffer>();
  private started?: Promise<void>;
  readyState = 0;
  bufferedAmount = 0;
  bulkAvailable = false;
  onopen: ChatSocket['onopen'] = null;
  onclose: ChatSocket['onclose'] = null;
  onerror: ChatSocket['onerror'] = null;
  onmessage: ChatSocket['onmessage'] = null;
  onbulk: ChatSocket['onbulk'] = null;
  constructor() {
    this.events.onmessage = batch => {
      if (this.readyState !== 1) return;
      try {
        for (const event of batch.events) {
          if (event.type === 'closed') { this.finish(event.code); return; }
          const frame = JSON.parse(event.data) as { type?: string; fileBulkV1?: boolean };
          if (frame.type === 'file-relay-ready') this.bulkAvailable = frame.fileBulkV1 === true;
          this.onmessage?.({ data: event.data });
        }
        this.acknowledge(batch.sequence, false);
      } catch { this.finish(1006); }
    };
    this.bulkEvents.onmessage = data => {
      if (this.readyState !== 1) return;
      try {
        const { sequence, records } = decodeGuiBulkBatch(data);
        for (const { sessionId, record } of records) this.onbulk?.(sessionId, record);
        this.acknowledge(sequence, true);
      } catch { this.finish(1006); }
    };
    queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } });
  }
  private acknowledge(sequence: number, bulk: boolean) {
    if (sequence) void invoke('gui_remote_ack', { request: { clientId: this.clientId, sequence, bulk } })
      .catch(() => this.finish(1006));
  }
  send(data: string) {
    const frame = JSON.parse(data) as { type?: string; sessionId?: string; ticket?: string };
    if (this.readyState !== 1 || this.started || frame.type !== 'file-relay-authenticate') {
      throw new Error('Invalid file authentication');
    }
    this.started = invoke('gui_remote_file_open', { request: { clientId: this.clientId,
      sessionId: frame.sessionId, ticket: frame.ticket, bulkEvents: this.bulkEvents }, events: this.events });
    void this.started.catch(() => this.finish(1006));
  }
  async sendBulk(sessionId: string, records: readonly Uint8Array[]) {
    if (this.readyState !== 1 || !this.bulkAvailable) throw new Error('File connection unavailable');
    const bytes = encodeBulkIpc(sessionId, records);
    if (this.bufferedAmount + bytes.length > MAX_FILE_BUFFER_BYTES) throw new Error('File connection busy');
    this.bufferedAmount += bytes.length;
    try { await invoke('gui_remote_bulk_send', bytes, { headers: { 'x-file-bulk-client': this.clientId } }); }
    finally { this.bufferedAmount -= bytes.length; }
  }
  private finish(code: number) {
    if (this.readyState === 3) return;
    this.close(); this.onclose?.({ code });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3; this.bulkAvailable = false;
    if (this.started) void this.started.then(() => invoke('gui_remote_close', { request: { clientId: this.clientId } }))
      .catch(() => { /* The worker also stops when its owning WebView or cloud identity disappears. */ });
  }
}
