import type { PaseoAgentHandle } from '@getpaseo/client';
import type { CliEntry } from '../../../shared/cli-gui/types';
import type { CliImages } from './images';
import { timelineEntry } from './mapping';

type TimelinePage = Awaited<ReturnType<PaseoAgentHandle['timeline']['refetch']>>;
const PAGE_SIZE = 100;
const MAX_CACHED_BOUNDARIES = 500;
const userCount = (page: TimelinePage) => page.entries.filter(entry => entry.item.type === 'user_message').length;

/** Native replay drops client IDs (and Gemini has no user message IDs at all).
 * Persist the user-turn ordinal before sending, then resolve it within each replay epoch.
 * Cache older-page counts so normal live refreshes never rescan the whole conversation.
 */
export class CliImageHistory {
  private offsets = new Map<string, number>();
  constructor(private readonly images: CliImages) {}

  private async offset(agent: PaseoAgentHandle, initial: TimelinePage): Promise<number> {
    const pending: { key: string; count: number }[] = [];
    let page = initial;
    let offset = 0;
    while (page.hasOlder) {
      const cursor = page.startCursor;
      if (!cursor) throw new Error('client.cliGui.historyFailed');
      const key = JSON.stringify([agent.id, cursor.epoch, cursor.seq]);
      const cached = this.offsets.get(key);
      if (cached !== undefined) { offset = cached; break; }
      pending.push({ key, count: userCount(page) });
      const older = await agent.timeline.refetch({ direction: 'before', cursor, limit: PAGE_SIZE, projection: 'projected' });
      if (older.error || !older.agent || older.startCursor?.epoch !== cursor.epoch
        || !older.entries.length || (older.startCursor && older.startCursor.seq >= cursor.seq)) {
        throw new Error('client.cliGui.historyFailed');
      }
      page = older;
    }
    let count = offset + userCount(page);
    for (const boundary of pending.reverse()) {
      this.offsets.set(boundary.key, count); count += boundary.count;
    }
    if (this.offsets.size > MAX_CACHED_BOUNDARIES) this.offsets.clear();
    return count - userCount(initial);
  }

  async nextOrdinal(agent: PaseoAgentHandle) {
    const page = await agent.timeline.refetch({ limit: PAGE_SIZE, projection: 'projected' });
    if (page.error || !page.agent) throw new Error('client.cliGui.historyFailed');
    return await this.offset(agent, page) + userCount(page) + 1;
  }

  async entries(agent: PaseoAgentHandle, page: TimelinePage): Promise<CliEntry[]> {
    const saved = await this.images.has(agent.id);
    let ordinal = saved ? await this.offset(agent, page) : 0;
    return Promise.all(page.entries.map(async entry => {
      const mapped = timelineEntry(entry.item, entry.seqStart, entry.seqEnd);
      if (!saved || entry.item.type !== 'user_message') return mapped;
      const image = await this.images.message(agent.id, ++ordinal, entry.item.clientMessageId ?? entry.item.messageId);
      return image ? { ...mapped, ...image } : mapped;
    }));
  }
}
