export const QUEUE_EVENT = 'chat/queue/updated';
export const QUEUE_PREVIEW_LENGTH = 1000;

/** The PC returns this preview with the ID of each queued message. */
export function queueTextPreview(text: string): string {
  return text.length > QUEUE_PREVIEW_LENGTH ? `${text.slice(0, QUEUE_PREVIEW_LENGTH)}…` : text;
}

/** Phone previews omit image data and PC-only attachment paths. The PC owns all pending messages. */
export interface QueueMessage {
  id: string;
  text: string;
  imageCount: number;
  attachmentCount: number;
  busy: boolean;
  error?: string;
}
export interface QueueSnapshot {
  revision: number;
  threads: Record<string, QueueMessage[]>;
  /** Recent explicit removals of messages that were never dispatched. */
  cancelledIds?: string[];
}
export interface QueueEnqueueResult extends QueueSnapshot { enqueuedId?: string }
export const emptyQueue = (): QueueSnapshot => ({ revision: -1, threads: {} });
export type QueueAction = 'queueSendNow' | 'queueRemove' | 'queueFlush' | 'queueMoveUp' | 'queueMoveDown';

export type QueueDraft = import('../../apps/desktop/src/pages/codexGui/types').MessageInput;
export interface QueueEditResult extends QueueSnapshot { draft: QueueDraft }
