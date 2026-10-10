export const TOKENS_PER_K = 1_000;
export const CONTEXT_CAPACITY_PRESETS_K = [128, 272, 384, 400, 1000];
export const MIN_CONTEXT_K = 1;
export const MAX_CONTEXT_K = 100_000;

export function parseContextCapacity(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(trimmed)) return undefined;
  const capacity = Math.round(Number(trimmed) * TOKENS_PER_K);
  return Number.isSafeInteger(capacity) && capacity >= MIN_CONTEXT_K * TOKENS_PER_K
    && capacity <= MAX_CONTEXT_K * TOKENS_PER_K ? capacity : undefined;
}
