import type { GuiEvent } from '../../../../shared/conversation/types';

const STREAM_FLUSH_MS = 40;
const MAX_DELTA_CHARS = 16 * 1024;

/** Combine adjacent token fragments without delaying turn boundaries or approval requests. */
export class EventStream {
  private pending?: GuiEvent;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly send: (event: GuiEvent) => void) {}

  receive(event: GuiEvent) {
    if (typeof event.params.delta !== 'string' || event.id != null) {
      this.flush();
      this.send(event);
      return;
    }
    if (this.pending && !this.compatible(event)) this.flush();
    this.pending = this.pending ? { ...event,
      params: { ...event.params, delta: this.pending.params.delta! + event.params.delta } } : event;
    if (this.pending.params.delta!.length >= MAX_DELTA_CHARS) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), STREAM_FLUSH_MS);
  }

  private compatible(event: GuiEvent) {
    const before = this.pending!;
    const fields = ['threadId', 'turnId', 'itemId', 'summaryIndex', 'contentIndex'] as const;
    return before.method === event.method && fields.every((field) => before.params[field] === event.params[field]);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const event = this.pending;
    this.pending = undefined;
    if (event) this.send(event);
  }

  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
