import type { DesktopInput } from './protocol';
import { relativeDesktopDelta, type DesktopViewport } from './geometry';

export const MAX_BUFFERED_INPUT = 256 * 1024;
const MOVE_INTERVAL = 16;

/** Coalesce pointer motion; button events flush it first so dragging preserves ordering. */
export class DesktopPointer {
  private position = { x: 0.5, y: 0.5 };
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.position;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.position = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    this.listeners.forEach(listener => listener());
    this.pending = true;
    return true;
  }
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  isHeld(button: 'left' | 'right' | 'middle') { return this.held.has(button); }
  private readonly held = new Set<'left' | 'right' | 'middle'>();
  constructor(private readonly send: (input: DesktopInput) => void) {}
  move(dx: number, dy: number, width: number, height: number) {
    if (!this.update(this.position.x + dx / Math.max(width, 1), this.position.y + dy / Math.max(height, 1))) return;
    this.timer ??= setTimeout(() => this.flush(), MOVE_INTERVAL);
  }
  moveInViewport(dx: number, dy: number, viewport: DesktopViewport) {
    const delta = relativeDesktopDelta(this.position, { x: dx, y: dy }, viewport);
    this.move(delta.x, delta.y, viewport.content.width - 1, viewport.content.height - 1);
  }
  absolute(x: number, y: number, immediate = true) {
    if (!this.update(x, y)) return;
    if (immediate) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), MOVE_INTERVAL);
  }
  /** Reassert the local target before clicking, even if the host's physical mouse moved. */
  synchronize() { this.pending = true; this.flush(); }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.pending) { this.pending = false; this.send({ kind: 'move', ...this.position }); }
  }
  button(button: 'left' | 'right' | 'middle', down: boolean) {
    if (this.held.has(button) === down) return;
    if (down) this.synchronize(); else this.flush();
    if (down) this.held.add(button); else this.held.delete(button);
    this.send({ kind: 'button', button, down });
    this.listeners.forEach(listener => listener());
  }
  click(button: 'left' | 'right' = 'left') {
    if (this.held.has(button)) return;
    this.button(button, true); this.button(button, false);
  }
  release() { this.button('left', false); this.button('right', false); this.button('middle', false); }
  dispose() {
    clearTimeout(this.timer); this.timer = undefined; this.pending = false; this.held.clear();
    this.listeners.forEach(listener => listener());
  }
}

export function sendDesktopInput(channel: RTCDataChannel | undefined, input: DesktopInput) {
  if (channel?.readyState !== 'open') return;
  if (channel.bufferedAmount > MAX_BUFFERED_INPUT) {
    // Never discard a button release: close the session, which releases held keys on the host.
    channel.close(); return;
  }
  channel.send(JSON.stringify(input));
}
