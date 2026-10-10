import type { QueueEnqueueResult, QueueSnapshot } from '../queue';
import type { SendInput, Thread } from './types';

const UNSUPPORTED_OPERATION = '当前手机端暂不支持此操作。';
type Request = <T>(body: Record<string, unknown>) => Promise<T>;

/** Negotiate queue support once per connection while keeping older PCs usable. */
export class QueueConnection {
  private supported = true;
  private generation = 0;
  constructor(private readonly request: Request) {}
  reset() { this.supported = true; this.generation++; }

  async read(): Promise<QueueSnapshot | null> {
    const generation = this.generation;
    try { return await this.request<QueueSnapshot>({ operation: 'queueRead' }); }
    catch (error) {
      if ((error instanceof Error ? error.message : error) !== UNSUPPORTED_OPERATION
        || generation !== this.generation) throw error;
      this.supported = false;
      return null;
    }
  }

  async enqueue(thread: Thread, input: SendInput): Promise<QueueEnqueueResult | null> {
    const generation = this.generation;
    if (this.supported) {
      return this.request<QueueEnqueueResult>({ operation: 'queueEnqueue', threadId: thread.id, ...input });
    }
    const running = thread.turns?.find((turn) => turn.status === 'inProgress');
    if (running) {
      await this.request({ operation: 'steer', threadId: thread.id, turnId: running.id,
        text: input.text, images: input.images ?? [], skills: input.skills ?? [] });
    } else {
      await this.request({ operation: 'resume', threadId: thread.id, access: input.access });
      if (generation !== this.generation) throw new Error('连接已中断，请连接后再发送。');
      await this.request({ operation: 'send', threadId: thread.id, ...input });
    }
    return null;
  }
}
