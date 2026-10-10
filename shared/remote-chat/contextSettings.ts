export { TOKENS_PER_K, CONTEXT_CAPACITY_PRESETS_K, MIN_CONTEXT_K, MAX_CONTEXT_K,
  parseContextCapacity } from '../context-usage/settings.js';
export const CONTEXT_READ_OPERATION = 'contextSettingsRead';
export const CONTEXT_WRITE_OPERATION = 'contextSettingsWrite';

export interface ContextSettings { capacity: number | null }
export interface ContextUpdateResult extends ContextSettings {
  update?: 'applied' | 'continued' | 'paused' | 'resumeFailed';
}
export interface ContextSettingsApi {
  read: (threadId: string) => Promise<ContextSettings>;
  write: (threadId: string, settings: ContextSettings) => Promise<ContextUpdateResult>;
}
