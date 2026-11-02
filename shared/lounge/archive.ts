import { parseMessage, type LoungeMessage } from './types';
import type { LoungeContact } from './contacts';

export const HISTORY_PAGE_SIZE = 50;
export const RECENT_MESSAGE_LIMIT = 200;
export const RECENT_BYTE_LIMIT = 24 * 1024 * 1024;
export interface HistoryCursor { time: number; key: string }
export interface HistoryQuery {
  query: string; before?: HistoryCursor; after?: HistoryCursor;
  limit?: number; conversation?: string; pendingOnly?: boolean;
}
export interface HistoryPage { messages: LoungeMessage[]; next?: HistoryCursor }
export interface LoungeHistoryStore {
  save(message: LoungeMessage): Promise<void>;
  page(query: HistoryQuery): Promise<HistoryPage>;
  contacts?(): Promise<LoungeContact[]>;
  saveContact?(contact: LoungeContact): Promise<void>;
  get?(key: string): Promise<LoungeMessage | undefined>;
  deleteConversation?(peer: string, generation?: number): Promise<void>;
}

export const historyScope = (baseUrl: string, account: string) =>
  JSON.stringify([baseUrl.replace(/\/+$/, ''), account.trim().toLowerCase()]);
export const historyKey = (message: LoungeMessage) => JSON.stringify([message.sender.id, message.id]);
export const historyPosition = (message: LoungeMessage): HistoryCursor =>
  ({ time: Date.parse(message.sentAt), key: historyKey(message) });
export const searchableHistory = (value: string) => value.normalize('NFKC').toLowerCase();
export const historyTerms = (query: string) => searchableHistory(query).trim().split(/\s+/).filter(Boolean);
export const historyText = (message: LoungeMessage) => searchableHistory(
  `${message.sender.account}\n${message.text}\n${message.reply?.account ?? ''}\n${message.reply?.text ?? ''}\n`
  + (message.attachments?.map(file => file.name).join('\n') ?? ''));
export const historyPageLimit = (query: HistoryQuery) =>
  Math.min(RECENT_MESSAGE_LIMIT, Math.max(1, query.limit ?? HISTORY_PAGE_SIZE));

export function messageBytes(message: LoungeMessage) {
  return (message.text.length + (message.reply?.text.length ?? 0) + (message.reply?.account.length ?? 0)
    + (message.sender.avatar?.length ?? 0)
    + (message.attachments?.reduce((total, file) => total + file.name.length + (file.grant?.length ?? 0), 0) ?? 0)
    + message.images.reduce((total, value) => total + value.length, 0)) * 2;
}

/** Bounds rendered messages only. The durable archive is never pruned by this limit. */
export function recentMessages(messages: readonly LoungeMessage[]): LoungeMessage[] {
  const unique = new Map(messages.map(message => [historyKey(message), message]));
  const ordered = [...unique.values()].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  const recent: LoungeMessage[] = [];
  let bytes = 0;
  for (const message of ordered.reverse()) {
    bytes += messageBytes(message);
    if (recent.length && (bytes > RECENT_BYTE_LIMIT || recent.length >= RECENT_MESSAGE_LIMIT)) break;
    recent.push(message);
  }
  return recent.reverse();
}

/** Also bounds image-heavy search pages without loading the entire archive into memory. */
export function historyPage(values: unknown[], query: HistoryQuery): HistoryPage {
  const messages: LoungeMessage[] = [];
  let bytes = 0;
  for (const value of values) {
    const message = parseMessage(value);
    if (!message) continue;
    bytes += messageBytes(message);
    if (messages.length && (messages.length >= historyPageLimit(query) || bytes > RECENT_BYTE_LIMIT)) {
      const next = historyPosition(messages[messages.length - 1]);
      return { messages: query.after ? messages.reverse() : messages, next };
    }
    messages.push(message);
  }
  return { messages: query.after ? messages.reverse() : messages };
}
