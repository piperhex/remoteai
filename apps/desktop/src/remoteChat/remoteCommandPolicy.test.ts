import { expect, it } from 'vitest';
import { DEFAULT_CHAT_POLICY, parseChatPolicy } from '../../../../shared/chat/chatPolicy';

it('shares remote command defaults and validation across desktop, remote and web policies', () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_CHAT_POLICY };
  delete legacy.remoteCommandConcurrencyLimit;
  expect(parseChatPolicy(legacy).remoteCommandConcurrencyLimit).toBe(5);
  for (const value of [1, 5, 8, 32]) {
    const parsed = parseChatPolicy({ ...legacy, remoteCommandConcurrencyLimit: value });
    expect(parsed.remoteCommandConcurrencyLimit).toBe(value);
    expect(parsed.chatSessionLimit).toBe(5);
  }
  for (const value of [0, -1, 1.5, 33, Infinity, NaN, null, '8']) {
    expect(() => parseChatPolicy({ ...legacy, remoteCommandConcurrencyLimit: value })).toThrow();
  }
});
