import { Channel as IpcChannel, invoke } from '@tauri-apps/api/core';
import type { TcpAddress, TcpNetwork, TcpSocket } from '../../../../shared/remote-chat/tcp/types';
import { desktopTcpCrypto } from './tcpChannel';

type Event = { socketId: string } & (
  { type: 'open'; localAddress: string; localPort: number; incoming: boolean }
  | { type: 'data'; data: number[] } | { type: 'closed' }
);
const MAX_BUFFER_BYTES = 512 * 1024;
const OPEN_TIMEOUT_MS = 8000;

class Socket implements TcpSocket {
  private closed = false;
  private receive?: (data: Uint8Array) => void;
  private readonly pending: Uint8Array[] = [];
  private readonly callbacks = new Set<() => void>();
  private queued = 0;
  private incoming = 0;
  private outgoing = Promise.resolve();

  constructor(readonly localAddress: string, readonly localPort: number,
    private readonly command: (action: { kind: string; data?: number[] }) => Promise<void>) {}

  get bufferedAmount() { return this.queued; }
  write(data: Uint8Array) {
    if (this.closed || this.queued + data.length > MAX_BUFFER_BYTES) throw new Error('TCP path busy');
    this.queued += data.length;
    this.outgoing = this.outgoing.then(() => {
      if (!this.closed) return this.command({ kind: 'write', data: Array.from(data) });
    }).catch(() => this.close()).finally(() => { this.queued -= data.length; });
  }
  accept(data: Uint8Array) {
    if (this.closed) return;
    if (this.receive) { this.receive(data); return; }
    this.incoming += data.length;
    if (this.incoming > MAX_BUFFER_BYTES) { this.close(); return; }
    this.pending.push(data);
  }
  onData(callback: (data: Uint8Array) => void) {
    this.receive = callback; this.incoming = 0; this.pending.splice(0).forEach(data => callback(data));
  }
  onClose(callback: () => void) { this.callbacks.add(callback); if (this.closed) callback(); }
  end() {
    if (this.closed) return;
    this.closed = true;
    this.pending.length = 0;
    this.callbacks.forEach(callback => callback());
    this.callbacks.clear();
  }
  close() {
    if (this.closed) return;
    this.end();
    void this.command({ kind: 'close' }).catch(() => { /* The native group may already have been revoked. */ });
  }
}

/** Rust validates every destination against the authenticated session before opening a socket. */
export class DesktopTcpNetwork implements TcpNetwork {
  readonly crypto = desktopTcpCrypto;
  localAddresses() { return invoke<string[]>('remote_chat_local_addresses'); }
  private readonly events = new IpcChannel<Event>();
  private readonly group: Promise<string>;
  private readonly sockets = new Map<string, Socket>();
  private readonly opening = new Map<string, {
    resolve: (socket: Socket) => void; reject: () => void; timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly listeners = new Map<boolean, (socket: TcpSocket) => void>();
  private stopped = false;

  constructor(sessionId: string, generation: number) {
    this.events.onmessage = event => this.receive(event);
    this.group = invoke<string>('remote_tcp_open', { request: { sessionId, generation }, events: this.events });
  }

  private async command(socketId: string, action: { kind: string; data?: number[] }) {
    await invoke('remote_tcp_socket', { request: { groupId: await this.group, socketId, action } });
  }

  private receive(event: Event) {
    if (event.type === 'open') {
      const socket = new Socket(event.localAddress, event.localPort, action => this.command(event.socketId, action));
      this.sockets.set(event.socketId, socket);
      if (this.stopped) { socket.close(); return; }
      const pending = this.opening.get(event.socketId);
      if (pending) { clearTimeout(pending.timer); this.opening.delete(event.socketId); pending.resolve(socket); }
      if (event.incoming) {
        const accept = this.listeners.get(event.localAddress.includes(':'));
        if (accept) accept(socket); else socket.close();
      }
      return;
    }
    const socket = this.sockets.get(event.socketId);
    if (event.type === 'closed') {
      socket?.end(); this.sockets.delete(event.socketId); this.opening.get(event.socketId)?.reject(); return;
    }
    try { socket?.accept(Uint8Array.from(event.data)); }
    finally { void this.command(event.socketId, { kind: 'ack' }).catch(() => socket?.close()); }
  }

  async listen(ipv6: boolean, accept: (socket: TcpSocket) => void) {
    this.listeners.set(ipv6, accept);
    const groupId = await this.group;
    if (this.stopped) throw new Error('TCP paths stopped');
    const port = await invoke<number>('remote_tcp_listen', { request: { groupId, ipv6 } });
    return { port, close: () => {
      this.listeners.delete(ipv6);
      void invoke('remote_tcp_unlisten', { request: { groupId, ipv6 } }).catch(() => {
        // Closing a generation also closes its listeners.
      });
    } };
  }

  async connect(address: TcpAddress & { localPort: number; ipv6: boolean }) {
    const groupId = await this.group;
    if (this.stopped) throw new Error('TCP paths stopped');
    const socketId = await invoke<string>('remote_tcp_connect', {
      request: { groupId, address: { host: address.host, port: address.port }, ipv6: address.ipv6 },
    });
    const socket = this.sockets.get(socketId);
    if (this.stopped) throw new Error('TCP path unavailable');
    if (socket) return socket;
    // IPC channel events and command responses can arrive in either order.
    return new Promise<Socket>((resolve, fail) => {
      const reject = () => {
        clearTimeout(timer); this.opening.delete(socketId);
        void this.command(socketId, { kind: 'close' }).catch(() => { /* Group may already be closed. */ });
        fail(new Error('TCP path unavailable'));
      };
      const timer = setTimeout(reject, OPEN_TIMEOUT_MS);
      this.opening.set(socketId, { resolve, reject, timer });
    });
  }

  close() {
    this.stopped = true;
    this.opening.forEach(pending => pending.reject());
    this.sockets.forEach(socket => socket.end());
    this.sockets.clear();
    void this.group.then(groupId => invoke('remote_tcp_close', { groupId })).catch(() => {
      // An attempt can close before native authorization/open completes.
    });
  }
}
