export const FULL_PERCENT: 100;
export function contextUsage(usage?: {
  last: { totalTokens: number };
  modelContextWindow?: number | null;
}): { used: number; capacity: number | null; percent: number | null } | null;
export function formatContextTokens(value: number, locale: string): string;
