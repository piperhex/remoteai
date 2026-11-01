import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatUsage } from './ChatUsage';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';

vi.mock('../i18n', async () => ({ ...await vi.importActual<typeof import('../i18n')>('../i18n'), useLanguage: () => 'zh' }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', Pressable: 'Pressable',
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('../../../../shared/remote-chat/client/useChatUsage', () => ({
  useChatUsage: () => ({ usage: null, error: '' }),
}));
vi.mock('../../../../shared/remote-chat/client/useConversationMetrics', () => ({ useConversationMetrics: vi.fn() }));

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return String(child);
    if (typeof child.type === 'function') {
      return text((child.type as (props: object) => ReactNode)(child.props));
    }
    return text(child.props.children);
  }).join('').replaceAll('\u00a0', ' ');
}
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.mocked(useConversationMetrics).mockReturnValue({
    totalOutputTokens: 300, totalOutputTimeMs: 2_000, outputRequestCount: 1,
    totalFirstTokenTimeMs: 2_500, firstTokenRequestCount: 2,
    successfulCommandCount: 3, completedCommandCount: 4,
    estimatedCostUsd: 1.23,
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('shows performance above the usage card with current tokens, cost and account credits', () => {
  const readConversationMetrics = vi.fn();
  const view = ChatUsage({ read: vi.fn(), active: true, ready: true, readConversationMetrics,
    threadId: 'mobile-thread', tokenUsage: { total: { totalTokens: 2_500 }, last: { totalTokens: 500 } } });
  expect(text(view)).toContain('额度点数—');
  expect(text(view)).toContain('2.50K Token');
  expect(text(view)).toContain('1.23 USD');
  expect(text(Children.toArray(view.props.children)[0])).toBe('75.0% TSR · 150.0 TPS · 1.25 TTFT');
  expect(useConversationMetrics).toHaveBeenCalledWith(readConversationMetrics, 'mobile-thread', true);
});

it('shows a placeholder and disables polling while disconnected or settings are inactive', () => {
  vi.mocked(useConversationMetrics).mockReturnValue(null);
  for (const state of [{ active: false, ready: true }, { active: true, ready: false }]) {
    const readConversationMetrics = vi.fn();
    expect(text(ChatUsage({ read: vi.fn(), readConversationMetrics, threadId: 'mobile-thread', ...state })))
      .toContain('当前— Token— USD');
    expect(useConversationMetrics).toHaveBeenLastCalledWith(readConversationMetrics, 'mobile-thread', false);
  }
});
