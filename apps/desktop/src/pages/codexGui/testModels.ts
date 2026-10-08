import type { Model } from './types';

/** Successful chat fixtures need usable models; an empty catalog represents a failed refresh. */
export const testModels: Model[] = ['gpt-test', 'old-model', 'next-model'].map((model, index) => ({
  id: model, model, displayName: model, isDefault: index === 0, defaultReasoningEffort: 'high',
  supportedReasoningEfforts: ['low', 'high'].map(reasoningEffort => ({ reasoningEffort, description: '' })),
}));
