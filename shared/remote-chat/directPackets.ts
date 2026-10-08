const MAX_BATCH_CHARS = 48 * 1024;
const MAX_BATCH_PACKETS = 8;

/** Batch existing encrypted packets only after the peer advertises support over an authenticated direct probe. */
export class DirectPackets {
  private enabled = false;
  private packets: string[] = [];
  private chars = 2;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly transport: { send: (payload: string) => void; failed: (error: unknown) => void }) {}

  enable() { this.enabled = true; }
  get bufferedAmount() { return this.packets.length ? this.chars : 0; }

  send(payload: string, bulk: boolean) {
    if (!this.enabled || !bulk) { this.transport.send(payload); return; }
    const chars = payload.length + 3;
    if (this.chars + chars > MAX_BATCH_CHARS) this.flush();
    if (chars + 2 > MAX_BATCH_CHARS) { this.transport.send(payload); return; }
    this.packets.push(payload);
    this.chars += chars;
    if (this.packets.length >= MAX_BATCH_PACKETS) this.flush();
    else this.timer ??= setTimeout(() => {
      try { this.flush(); } catch (error) { this.transport.failed(error); }
    }, 0);
  }

  private flush() {
    const packets = this.packets;
    this.clear();
    if (packets.length) this.transport.send(packets.length === 1 ? packets[0] : JSON.stringify(packets));
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.packets = [];
    this.chars = 2;
  }
}

/** Packet contents retain their individual authentication and replay checks; the outer batch grants no trust. */
export function directPackets(payload: string): string[] {
  if (!payload.startsWith('[')) return [payload];
  if (payload.length > MAX_BATCH_CHARS) throw new Error('Invalid direct batch');
  const packets: unknown = JSON.parse(payload);
  if (!Array.isArray(packets) || !packets.length || packets.length > MAX_BATCH_PACKETS
    || packets.some((packet) => typeof packet !== 'string' || !/^[a-f0-9]+$/.test(packet))) {
    throw new Error('Invalid direct batch');
  }
  return packets as string[];
}
