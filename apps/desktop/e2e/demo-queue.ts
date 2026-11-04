import { QUEUE_EVENT, type QueueSnapshot } from '../../../shared/remote-chat/queue';
import type { Thread } from '../../../shared/conversation/types';
import type { ChatLink } from '../../../shared/remote-chat/link';

interface Pending { id: string; input: Record<string, unknown> }
interface QueueHost {
  thread: Thread;
  link: Pick<ChatLink, 'send'>;
  send: (input: Record<string, unknown>) => void;
  steer: (input: Record<string, unknown>) => void;
}
const pending = new Map<string, Pending[]>();
let revision = 0;

export function demoQueueSnapshot(): QueueSnapshot {
  return { revision, threads: Object.fromEntries([...pending].filter(([, items]) => items.length)
    .map(([threadId, items]) => [threadId, items.map(({ id, input }) => ({ id, text: String(input.text),
      imageCount: Array.isArray(input.images) ? input.images.length : 0, attachmentCount: 0, busy: false }))])) };
}

function publish(link: Pick<ChatLink, 'send'>) {
  revision++;
  void link.send({ kind: 'event', event: { method: QUEUE_EVENT, params: demoQueueSnapshot() } })
    .catch(() => { /* A disconnected phone fetches the authoritative snapshot on reconnect. */ });
}

export function flushDemoQueue(host: QueueHost) {
  if (host.thread.turns?.some((turn) => turn.status === 'inProgress')) return;
  const items = pending.get(host.thread.id) ?? [];
  if (!items.length) return;
  pending.delete(host.thread.id);
  host.send({ ...items[0].input, text: items.map(({ input }) => input.text).join('\n') });
  publish(host.link);
}

export function demoQueueRequest(input: Record<string, unknown>, host: QueueHost) {
  const threadId = host.thread.id;
  const items = pending.get(threadId) ?? [];
  const selected = items.find((item) => item.id === input.id);
  if (input.operation === 'queueEdit') {
    if (!selected) throw new Error('这条消息已开始发送或已被移除。');
    pending.set(threadId, items.filter((item) => item !== selected));
    publish(host.link);
    return { ...demoQueueSnapshot(), draft: { images: [], skills: [], ...selected.input } };
  }
  if (input.operation === 'queueMoveUp' || input.operation === 'queueMoveDown') {
    const index = items.findIndex((item) => item === selected);
    const neighbor = index + (input.operation === 'queueMoveUp' ? -1 : 1);
    if (selected && items[neighbor]) [items[index], items[neighbor]] = [items[neighbor], selected];
  }
  if (input.operation === 'queueEnqueue') pending.set(threadId, [...items, { id: crypto.randomUUID(), input }]);
  if (input.operation === 'queueRemove') pending.set(threadId, items.filter((item) => item.id !== input.id));
  if (input.operation === 'queueSendNow') {
    const item = items.find((entry) => entry.id === input.id);
    const turn = host.thread.turns?.find((entry) => entry.status === 'inProgress');
    if (item && turn) {
      host.steer({ ...item.input, turnId: turn.id });
      pending.set(threadId, items.filter((entry) => entry !== item));
    }
  }
  publish(host.link);
  flushDemoQueue(host);
  return demoQueueSnapshot();
}
