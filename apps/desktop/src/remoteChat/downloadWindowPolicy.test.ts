import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_POLICY, getChatPolicy, parseChatPolicy, setChatConnectionMode, setChatPolicy,
  subscribeChatPolicy } from '../../../../shared/remote-chat/policy';

afterEach(() => { setChatConnectionMode('offline'); setChatPolicy(DEFAULT_CHAT_POLICY); });

it('defaults older server settings to five blocks and keeps the configured window in direct mode', () => {
  const legacy: Record<string, unknown> = { ...DEFAULT_CHAT_POLICY };
  delete legacy.fileDownloadWindowSize;
  expect(parseChatPolicy(legacy).fileDownloadWindowSize).toBe(5);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: 9 });
  setChatConnectionMode('direct');
  expect(getChatPolicy().fileDownloadWindowSize).toBe(9);
});

it.each([0, -1, 13, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null])('rejects an invalid window: %s', value => {
  expect(() => parseChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: value })).toThrow();
});

it('publishes validated updates to native downloads and releases subscriptions', () => {
  const listener = vi.fn(() => getChatPolicy().fileDownloadWindowSize);
  const unsubscribe = subscribeChatPolicy(listener);
  try {
    setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: 12 });
    expect(listener).toHaveReturnedWith(12);
    expect(() => setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileDownloadWindowSize: 0 })).toThrow();
    expect(listener).toHaveBeenCalledOnce();
  } finally { unsubscribe(); }
  setChatPolicy(DEFAULT_CHAT_POLICY);
  expect(listener).toHaveBeenCalledOnce();
});
