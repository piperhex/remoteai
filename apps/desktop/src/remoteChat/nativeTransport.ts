import { Channel, invoke } from '@tauri-apps/api/core';
import { encodeBulkRelay } from '../../../../shared/remote-chat/bulkRelayWire';

export type HostTransportEvent = { generation: number } & (
  { type: 'ready' | 'reset' | 'disconnected' } | { type: 'message'; data: string }
);
interface Batch { sequence: number; events: HostTransportEvent[] }
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
let lifecycle = Promise.resolve();

/** Rust owns registration and reconnect timers; IPC only carries peer protocol frames. */
export class NativeChatTransport {
  private readonly clientId = crypto.randomUUID();
  private readonly channel = new Channel<Batch>();
  private readonly started: Promise<void>;
  private outgoing = Promise.resolve();
  private closed = false;
  private registered = false;
  private generation = 0;
  private buffered = 0;

  constructor(private readonly receive: (event: HostTransportEvent) => void) {
    this.channel.onmessage = (batch) => this.deliver(batch);
    // StrictMode can mount/unmount before an IPC command resolves. Preserve lifecycle order.
    this.started = lifecycle.then(async () => {
      if (!this.closed) await invoke('remote_chat_attach', {
        request: { clientId: this.clientId }, events: this.channel,
      });
    });
    lifecycle = this.started.catch(() => undefined);
    void this.started.catch(() => {
      if (!this.closed) this.receive({ type: 'reset', generation: this.generation });
    });
  }

  get ready() { return this.registered && !this.closed; }
  get bufferedAmount() { return this.buffered; }

  async sendBulk(sessionId: string, record: Uint8Array) {
    if (!this.ready) throw new Error('Download connection unavailable');
    const bytes = encodeBulkRelay(sessionId, record);
    this.buffered += bytes.length;
    try {
      await invoke('remote_chat_bulk_send', bytes, { headers: {
        'x-file-bulk-client': this.clientId, 'x-file-bulk-generation': String(this.generation),
      } });
    } finally { this.buffered -= bytes.length; }
  }

  private deliver(batch: Batch) {
    if (this.closed) return;
    try {
      for (const event of batch.events) {
        if (event.generation < this.generation) continue;
        this.generation = event.generation;
        if (event.type !== 'message') this.registered = event.type === 'ready';
        this.receive(event);
      }
    } catch {
      this.reconnect(true);
    } finally {
      void invoke('remote_chat_ack', { request: { clientId: this.clientId, sequence: batch.sequence } })
        .catch(() => this.reconnect(true));
    }
  }

  send(message: object) {
    if (!this.ready) throw new Error('Disconnected');
    this.enqueue(message);
  }

  forgetSession(sessionId: string) {
    if (!this.closed) this.enqueue({ type: 'peer-close', sessionId }, true);
  }

  private enqueue(message: object, forgetting = false) {
    const bytes = new TextEncoder().encode(JSON.stringify(message)).length;
    if (this.buffered + bytes > MAX_BUFFER_BYTES) throw new Error('Chat connection busy');
    const generation = this.generation;
    this.buffered += bytes;
    const sent = this.outgoing.then(async () => {
      await this.started;
      if (this.closed || (!forgetting && generation !== this.generation)) return;
      await invoke('remote_chat_send', { request: { clientId: this.clientId, generation, message } });
    });
    this.outgoing = sent.catch(() => {
      // Diagnostics are best-effort; an IPC rejection must not restart every paired chat.
      if ('type' in message && message.type === 'diagnostic') return;
      if (!this.closed && generation === this.generation) this.reconnect();
    }).finally(() => { this.buffered -= bytes; });
  }

  reconnect(reset = false) {
    if (this.closed) return;
    this.registered = false;
    void this.started.then(() => {
      if (!this.closed) return invoke('remote_chat_reconnect', {
        request: { clientId: this.clientId, generation: this.generation, reset },
      });
    }).catch(() => {
      if (!this.closed) this.receive({ type: 'reset', generation: this.generation });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.registered = false;
    lifecycle = lifecycle.then(() => invoke<void>('remote_chat_detach', { request: { clientId: this.clientId } }))
      .catch(() => undefined);
  }
}
