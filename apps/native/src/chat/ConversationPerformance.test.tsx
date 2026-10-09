import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatUsage } from './ChatUsage';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';

vi.mock('../i18n', () => ({ t: (value: string) => value, useLanguage: () => 'zh' }));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View', Pressable: 'Pressable',
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
  }).join('');
}
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.mocked(useConversationMetrics).mockReturnValue({
    totalOutputTokens: 300, totalOutputTimeMs: 2_000, outputRequestCount: 1,
    totalFirstTokenTimeMs: 2_500, firstTokenRequestCount: 2,
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('shows TPS and TTFT to the right of current conversation tokens in mobile settings', () => {
  const readConversationMetrics = vi.fn();
  const content = text(ChatUsage({ read: vi.fn(), active: true, ready: true, readConversationMetrics,
    threadId: 'mobile-thread', tokenUsage: { total: { totalTokens: 2_500 }, last: { totalTokens: 500 } } }));
  expect(content).toContain('当前对话 2.50K Token · 150.0 TPS TTFT 1.25 s');
  expect(useConversationMetrics).toHaveBeenCalledWith(readConversationMetrics, 'mobile-thread', true);
});

it('shows a placeholder and disables polling while disconnected or settings are inactive', () => {
  vi.mocked(useConversationMetrics).mockReturnValue(null);
  for (const state of [{ active: false, ready: true }, { active: true, ready: false }]) {
    const readConversationMetrics = vi.fn();
    expect(text(ChatUsage({ read: vi.fn(), readConversationMetrics, threadId: 'mobile-thread', ...state })))
      .toContain('当前对话 — Token · — TPS TTFT —');
    expect(useConversationMetrics).toHaveBeenLastCalledWith(readConversationMetrics, 'mobile-thread', false);
  }
});
