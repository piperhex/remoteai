import type { Channel, PeerOptions } from './protocol';
import type { ConnectionEndpoints } from './connectionEndpoints';
import { ChannelBackpressureError } from './channelBackpressure';

const PROBE_MS = 1000;
const PATH_TIMEOUT_MS = 3000;
const MAX_ENVELOPE_CHARS = 100_000;
const MIN_SWITCH_GAIN_MS = 20;
const MIN_SWITCH_INTERVAL_MS = 5000;
interface Path { channel: Channel; priority: number; pong: number; probe: number;
  rtt?: number; samples: number; transport: 'rtc' | 'tcp' | 'mesh'; pending: Map<number, number> }

/** Peers may select different outgoing paths; every incoming path carries the same authenticated chat protocol. */
export class MultipathChannel implements Channel {
  private readonly paths = new Set<Path>();
  private selected?: Path;
  private selectedAt = 0;
  private state = 'connecting';
  private readonly opened = new Set<() => void>();
  private readonly closed = new Set<() => void>();
  private readonly messages = new Set<(text: string, endpoints: ConnectionEndpoints) => void>();
  private readonly timer = setInterval(() => this.tick(), PROBE_MS);

  constructor(private readonly options: Pick<PeerOptions, 'stateChanged' | 'disconnected' | 'diagnostic'>) {}
  get readyState() { return this.state; }
  get bufferedAmount() { return this.selected?.channel.bufferedAmount ?? 0; }
  get connectionEndpoints() { return this.state === 'open' ? this.selected?.channel.connectionEndpoints : undefined; }
  onOpen(callback: () => void) { this.opened.add(callback); }
  onClose(callback: () => void) { this.closed.add(callback); }
  onMessage(callback: (text: string, endpoints?: ConnectionEndpoints) => void) { this.messages.add(callback); }

  add(channel: Channel, priority: number, transport: Path['transport'] = priority === 0 ? 'rtc' : 'tcp') {
    if (this.state === 'closed') { channel.close(); return; }
    const path: Path = { channel, priority, transport, pong: 0, probe: 0, samples: 0, pending: new Map() };
    this.paths.add(path);
    channel.onMessage((text, endpoints) => this.receive(path, text, endpoints));
    channel.onOpen(() => this.probe(path));
    channel.onClose(() => { this.paths.delete(path); this.choose(); });
    if (channel.readyState === 'open') this.probe(path);
  }

  private probe(path: Path) {
    if (path.channel.readyState !== 'open') return;
    const sequence = ++path.probe;
    path.pending.set(sequence, Date.now());
    if (path.pending.size > 4) path.pending.delete(path.pending.keys().next().value!);
    this.write(path, ['ping', sequence]);
  }

  private write(path: Path, frame: unknown[]) {
    try { path.channel.send(JSON.stringify(frame)); }
    catch (error) {
      // A full send queue does not invalidate the last pong; the usual heartbeat timeout still applies.
      if (!(error instanceof ChannelBackpressureError)) path.pong = 0;
    }
  }

  private receive(path: Path, text: string, endpoints?: ConnectionEndpoints) {
    if (this.state === 'closed' || !this.paths.has(path)) return;
    try {
      if (text.length > MAX_ENVELOPE_CHARS) throw new Error('Invalid path packet');
      const frame: unknown = JSON.parse(text);
      if (!Array.isArray(frame) || frame.length !== 2) throw new Error('Invalid path frame');
      if (frame[0] === 'ping' && Number.isSafeInteger(frame[1])) this.write(path, ['pong', frame[1]]);
      else if (frame[0] === 'pong' && path.pending.has(Number(frame[1]))) {
        const measured = Date.now() - path.pending.get(Number(frame[1]))!;
        path.rtt = path.rtt === undefined ? measured : path.rtt * 0.75 + measured * 0.25;
        path.samples += 1;
        path.pending.delete(Number(frame[1]));
        path.pong = Date.now(); this.choose();
      } else if (frame[0] === 'data' && typeof frame[1] === 'string') {
        // Incoming and outgoing paths may differ. Preserve the innermost source, even when unknown.
        const source = endpoints ?? path.channel.connectionEndpoints ?? {};
        this.messages.forEach(callback => callback(frame[1], source));
      }
    } catch { path.channel.close(); }
  }

  private choose() {
    if (this.state === 'closed') return;
    const now = Date.now();
    const previous = this.selected;
    this.selected = this.bestPath(now);
    if (previous !== this.selected) this.selectedAt = now;
    if (previous !== this.selected && this.selected) this.options.diagnostic?.('path-selected', {
      transport: this.selected.transport, rttMs: this.selected.rtt,
    });
    const state = this.selected ? 'open' : 'connecting';
    if (state === this.state) return;
    this.state = state;
    this.options.stateChanged?.(state === 'open' ? 'connected' : 'disconnected');
    if (state === 'open') this.opened.forEach(callback => callback());
    else this.options.disconnected();
  }

  private bestPath(now: number) {
    const healthy = [...this.paths].filter(path => path.channel.readyState === 'open'
      && path.pong > 0 && now - path.pong < PATH_TIMEOUT_MS).sort((a, b) => a.priority - b.priority);
    const preferred = healthy[0];
    if (!this.selected || !healthy.includes(this.selected)) return preferred;
    const fastest = healthy.filter(path => path.samples >= 3).sort((a, b) => a.rtt! - b.rtt!)[0];
    // Preserve protocol preference on equal paths, but escape persistently slow direct routes.
    if (preferred?.priority < this.selected.priority && (preferred.rtt ?? 0) <= (this.selected.rtt ?? 0)) return preferred;
    if (fastest && now - this.selectedAt >= MIN_SWITCH_INTERVAL_MS
      && this.selected.rtt! - fastest.rtt! > Math.max(MIN_SWITCH_GAIN_MS, this.selected.rtt! * 0.2)) return fastest;
    return this.selected;
  }

  private tick() { this.paths.forEach(path => this.probe(path)); this.choose(); }

  send(text: string) {
    if (!this.selected || this.state !== 'open') throw new Error('Direct paths unavailable');
    this.selected.channel.send(JSON.stringify(['data', text]));
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearInterval(this.timer);
    this.paths.forEach(path => path.channel.close());
    this.paths.clear();
    this.closed.forEach(callback => callback());
    this.opened.clear(); this.closed.clear(); this.messages.clear();
  }
}
