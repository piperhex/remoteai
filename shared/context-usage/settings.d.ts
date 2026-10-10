export const TOKENS_PER_K: 1000;
export const CONTEXT_CAPACITY_PRESETS_K: readonly number[];
export const MIN_CONTEXT_K: 1;
export const MAX_CONTEXT_K: 100000;
export function parseContextCapacity(value: string): number | null | undefined;
