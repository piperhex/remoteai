// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { formatConversationTps, formatConversationTtft, type ConversationMetrics,
  type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';

const metrics: ConversationMetrics = { totalOutputTokens: 400, totalOutputTimeMs: 4_000, outputRequestCount: 2,
  totalFirstTokenTimeMs: 2_500, firstTokenRequestCount: 2 };
let root: Root;
let result: ReturnType<typeof useConversationMetrics>;
function Probe({ read, threadId = 'first', active = true }: {
  read: ReadConversationMetrics; threadId?: string | null; active?: boolean;
}) {
  result = useConversationMetrics(read, threadId, active);
  return <button>{formatConversationTps(result)} TPS</button>;
}
function deferred() {
  let resolve!: (value: ConversationMetrics) => void;
  const promise = new Promise<ConversationMetrics>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('formats measured output speed and distinguishes zero from missing or malformed samples', () => {
  expect(formatConversationTps(metrics)).toBe('100.0');
  expect(formatConversationTps({ ...metrics, totalOutputTokens: 0 })).toBe('0.0');
  for (const invalid of [null, { ...metrics, outputRequestCount: 0 }, { ...metrics, totalOutputTimeMs: 0 },
    { ...metrics, totalOutputTimeMs: Infinity }, { ...metrics, totalOutputTokens: NaN }]) {
    expect(formatConversationTps(invalid)).toBe('—');
  }
});

it('does not overlap slow requests, including while briefly hiding and reopening settings', async () => {
  const slow = deferred();
  const read = vi.fn<ReadConversationMetrics>().mockReturnValueOnce(slow.promise).mockResolvedValue(metrics);
  await act(async () => root.render(<Probe read={read} />));
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe read={read} active={false} />));
  await act(async () => root.render(<Probe read={read} />));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => slow.resolve(metrics));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(read).toHaveBeenCalledTimes(2);
  expect(result).toEqual(metrics);
  await act(async () => root.render(<Probe read={read} active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(result).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

it('formats average TTFT in seconds and leaves missing, old or invalid measurements unknown', () => {
  expect(formatConversationTtft(metrics)).toBe('1.25 s');
  expect(formatConversationTtft({ ...metrics, totalFirstTokenTimeMs: 0 })).toBe('0.00 s');
  const oldHost = { totalOutputTokens: 100, totalOutputTimeMs: 1_000, outputRequestCount: 1 };
  for (const invalid of [null, oldHost, { ...metrics, firstTokenRequestCount: 0 },
    { ...metrics, firstTokenRequestCount: Infinity }, { ...metrics, firstTokenRequestCount: 1.5 },
    { ...metrics, totalFirstTokenTimeMs: Infinity }, { ...metrics, totalFirstTokenTimeMs: NaN },
    { ...metrics, totalFirstTokenTimeMs: -1 }]) {
    expect(formatConversationTtft(invalid)).toBe('—');
  }
});

it('never displays a late result from a previous conversation or remote device', async () => {
  const first = deferred();
  const second = deferred();
  const read = vi.fn<ReadConversationMetrics>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => root.render(<Probe read={read} />));
  await act(async () => root.render(<Probe read={read} threadId="second" />));
  expect(read).toHaveBeenLastCalledWith('second');
  await act(async () => first.resolve(metrics));
  expect(result).toBeNull();
  const otherDevice = vi.fn<ReadConversationMetrics>().mockResolvedValue({ ...metrics, totalOutputTokens: 800 });
  await act(async () => root.render(<Probe read={otherDevice} threadId="second" />));
  await act(async () => second.resolve(metrics));
  expect(formatConversationTps(result)).toBe('200.0');
});

it('clears stale speed on failure, recovers and does not query new or disconnected conversations', async () => {
  const read = vi.fn<ReadConversationMetrics>().mockResolvedValueOnce(metrics)
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(metrics);
  await act(async () => root.render(<Probe read={read} threadId={null} />));
  expect(read).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe read={read} />));
  expect(result).toEqual(metrics);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(result).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(result).toEqual(metrics);
  await act(async () => root.render(<Probe read={read} active={false} />));
  expect(result).toBeNull();
});
