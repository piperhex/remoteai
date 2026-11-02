import { historyKey } from './archive';
import type { LoungeMessage } from './types';

export interface HistoryTimelineRow { key: string; message: LoungeMessage; date?: string }

/** The date belongs above the oldest message of each local calendar day, including across page boundaries. */
export function historyTimelineRows(messages: LoungeMessage[], locale: string): HistoryTimelineRow[] {
  const year = new Date().getFullYear();
  const currentYear = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  const otherYear = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  return messages.map((message, index) => {
    const date = new Date(message.sentAt);
    const older = messages[index + 1];
    const startsDay = !older || date.toDateString() !== new Date(older.sentAt).toDateString();
    const format = date.getFullYear() === year ? currentYear : otherYear;
    return { key: historyKey(message), message, date: startsDay ? format.format(date) : undefined };
  });
}
