import type { GuiEvent } from '../remote-chat/client/types';

const FALLBACK_FRAME_MS = 32;
const TEXT_DELTAS = new Set(['item/agentMessage/delta', 'item/plan/delta', 'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta', 'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta']);

export function isTextDelta(event: GuiEvent) {
  return event.id == null && TEXT_DELTAS.has(event.method) && typeof event.params.delta === 'string';
}

function sameTarget(left: GuiEvent, right: GuiEvent) {
  if (left.method !== right.method) return false;
  const keys = new Set([...Object.keys(left.params), ...Object.keys(right.params)]);
  // Include all semantic parameters, including reasoning part indices and future protocol extensions.
  return [...keys].every(key => key === 'delta'
    || Reflect.get(left.params, key) === Reflect.get(right.params, key));
}

/** Coalesce adjacent text events only; lifecycle events remain ordering barriers in the caller. */
export class StreamFrame {
  private events: GuiEvent[] = [];
  private frame?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private document?: Document;

  constructor(private readonly publish: (events: GuiEvent[]) => void) {}

  push(event: GuiEvent) {
    const previous = this.events.at(-1);
    if (previous && sameTarget(previous, event)) {
      this.events[this.events.length - 1] = { ...previous,
        params: { ...previous.params, delta: previous.params.delta! + event.params.delta! } };
    } else this.events.push(event);
    if (this.timer !== undefined) return;
    this.document = typeof document === 'undefined' ? undefined : document;
    this.document?.addEventListener('visibilitychange', this.visibilityChanged);
    // rAF can stop entirely in hidden windows. The timer and visibility flush keep state/persistence current.
    this.timer = setTimeout(this.flush, FALLBACK_FRAME_MS);
    if (!this.document?.hidden && typeof requestAnimationFrame === 'function') {
      this.frame = requestAnimationFrame(this.flush);
    }
  }

  private visibilityChanged = () => this.flush();

  flush = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.document?.removeEventListener('visibilitychange', this.visibilityChanged);
    this.document = undefined;
    const events = this.events;
    this.events = [];
    if (events.length) this.publish(events);
  };
}
