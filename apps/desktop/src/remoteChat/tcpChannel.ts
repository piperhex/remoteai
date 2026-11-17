import { invoke } from '@tauri-apps/api/core';
import { connectionEndpoint } from '../../../../shared/remote-chat/connectionEndpoints';
import type { Channel } from '../../../../shared/remote-chat/protocol';
import type { TcpCryptoOptions } from '../../../../shared/remote-chat/tcp/types';

const MAX_QUEUED = 512 * 1024;
const MAX_OPERATIONS = 128;
const MAX_BATCH = 32;
const HANDSHAKE_TIMEOUT_MS = 5000;
type Operation = { kind: 'send'; text: string } | { kind: 'receive'; data: number[] };
interface Output { writes: number[][]; messages: string[]; open: boolean }

/** Rust owns TCP authentication, framing, directional nonces and AEAD; JS only adapts socket events. */
export class DesktopTcpChannel implements Channel {
  private state = 'connecting';
  private readonly handle: Promise<string>;
  private readonly queue: { operation: Operation; bytes: number }[] = [];
  private queued = 0;
  private pending = 0;
  private running = false;
  private outgoing = Promise.resolve();
  private readonly opened = new Set<() => void>();
  private readonly closed = new Set<() => void>();
  private readonly messages = new Set<(text: string) => void>();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly options: TcpCryptoOptions) {
    const secret = Array.from(options.secret);
    this.timer = setTimeout(() => this.close(), HANDSHAKE_TIMEOUT_MS);
    this.handle = invoke<{ id: string; output: Output }>('remote_chat_tcp_crypto_open', { request: {
      secret, publicKey: options.publicKey, sessionId: options.sessionId, desktop: options.desktop,
    } }).then(({ id, output }) => {
      // Return the handle even when the socket closed during open, so close() can dispose it.
      try { this.accept(output); } catch { this.close(); }
      return id;
    }).finally(() => secret.fill(0));
    void this.handle.catch(() => this.close());
    options.socket.onClose(() => this.close());
    options.socket.onData(data => {
      if (this.state === 'closed') return;
      try { this.enqueue({ kind: 'receive', data: Array.from(data) }, data.length); }
      catch { this.close(); }
    });
  }

  get readyState() { return this.state; }
  get bufferedAmount() { return this.queued + this.options.socket.bufferedAmount; }
  get connectionEndpoints() {
    if (this.state !== 'open') return;
    const socket = this.options.socket;
    return { local: connectionEndpoint(socket.localAddress, socket.localPort, 'tcp'),
      remote: connectionEndpoint(socket.remoteAddress, socket.remotePort, 'tcp') };
  }
  onOpen(callback: () => void) { this.opened.add(callback); }
  onClose(callback: () => void) { if (this.state === 'closed') callback(); else this.closed.add(callback); }
  onMessage(callback: (text: string) => void) { this.messages.add(callback); }

  send(text: string) {
    if (this.state !== 'open') throw new Error('CHAT_PACKET_CODEC');
    try { this.enqueue({ kind: 'send', text }, new TextEncoder().encode(text).length); }
    catch (error) { this.close(); throw error; }
  }

  private enqueue(operation: Operation, bytes: number) {
    if (this.queued + bytes > MAX_QUEUED || this.pending >= MAX_OPERATIONS) throw new Error('CHAT_PACKET_CODEC');
    this.queued += bytes; this.pending++;
    this.queue.push({ operation, bytes });
    this.schedule();
  }

  private schedule() {
    if (this.running) return;
    this.running = true;
    this.outgoing = this.drain().catch(() => this.close()).finally(() => {
      this.running = false;
      if (this.queue.length && this.state !== 'closed') this.schedule();
    });
  }

  private async drain() {
    const id = await this.handle;
    while (this.queue.length && this.state !== 'closed') {
      const batch = this.queue.splice(0, MAX_BATCH);
      try {
        this.accept(await invoke<Output>('remote_chat_tcp_crypto_batch', {
          id, operations: batch.map(item => item.operation),
        }));
      } finally {
        this.queued -= batch.reduce((sum, item) => sum + item.bytes, 0); this.pending -= batch.length;
      }
    }
  }

  private accept(output: Output) {
    if (this.state === 'closed') return;
    output.writes.forEach(data => this.options.socket.write(Uint8Array.from(data)));
    if (output.open && this.state !== 'open') {
      this.state = 'open'; clearTimeout(this.timer); this.opened.forEach(callback => callback());
    }
    output.messages.forEach(text => this.messages.forEach(callback => callback(text)));
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed'; clearTimeout(this.timer);
    this.options.socket.close();
    const queued = this.queue.splice(0);
    this.queued -= queued.reduce((sum, item) => sum + item.bytes, 0); this.pending -= queued.length;
    this.closed.forEach(callback => callback());
    this.closed.clear(); this.opened.clear(); this.messages.clear();
    void this.outgoing.then(() => this.handle).then(id => invoke('remote_chat_tcp_crypto_close', { id }))
      .catch(() => { /* A failed open or closed application has no reachable native codec. */ });
  }
}

export const desktopTcpCrypto = {
  async keyPair() {
    const pair = await invoke<{ secret: number[]; publicKey: string }>('remote_chat_crypto_keypair');
    const secret = Uint8Array.from(pair.secret); pair.secret.fill(0);
    return { secret, publicKey: pair.publicKey };
  },
  channel: (options: TcpCryptoOptions) => new DesktopTcpChannel(options),
};
