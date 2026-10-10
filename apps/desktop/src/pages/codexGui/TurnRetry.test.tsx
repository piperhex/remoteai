// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TurnRetryProvider } from '../../../../../shared/chat/TurnRetryContext';
import { failedTurnTarget } from '../../../../../shared/chat/turnRetry';
import { ChatTurnSummary } from '../../../../web/src/chat/ChatTurnSummary';
import { TurnMessage } from './TurnMessage';
import { restoreRequestErrors } from './turnRequestErrors';
import { MODEL_CAPACITY_MESSAGE } from './requestError';
import type { Turn } from './types';

let root: Root;
let container: HTMLDivElement;
const failed: Turn = { id: 'failed', status: 'failed', items: [], error: { message: 'HTTP 502 Bad Gateway' } };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

for (const surface of ['desktop', 'web']) {
  const render = (turns: Turn[], send: () => Promise<boolean>, disabled = false) => act(async () => root.render(
    <TurnRetryProvider target={failedTurnTarget('thread', turns)} disabled={disabled} onRetry={send}>
      <input defaultValue="未发送的草稿" />
      {turns.map(turn => surface === 'desktop'
        ? <TurnMessage key={turn.id} turn={restoreRequestErrors(turn)} running={false} active />
        : <ChatTurnSummary key={turn.id} turn={turn} onOpen={() => {}} />)}
    </TurnRetryProvider>));
  const retryButton = () => [...container.querySelectorAll('button')].find(button => /^(重试|正在重试…)$/.test(
    button.textContent ?? ''));

  it(`${surface}: retries once, keeps drafts and waits for the new turn after acknowledgement`, async () => {
    let finish!: (success: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await render([failed], send);
    expect(retryButton()).toBeDefined();
    expect(container.textContent).toContain('本次回复遇到问题，已中断。');
    await act(async () => { retryButton()!.click(); retryButton()!.click(); });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ threadId: 'thread', turnId: 'failed' });
    expect(retryButton()?.disabled).toBe(true);
    await act(async () => finish(true));
    expect(retryButton()?.disabled).toBe(true);
    expect(container.querySelector('input')?.value).toBe('未发送的草稿');
    await render([failed, { id: 'continued', status: 'inProgress', items: [] }], send);
    expect(retryButton()).toBeUndefined();
  });

  it(`${surface}: allows retry after sending fails and disables the action while unavailable`, async () => {
    const send = vi.fn().mockResolvedValue(false);
    await render([failed], send, true);
    await act(async () => retryButton()!.click());
    expect(send).not.toHaveBeenCalled();
    await render([failed], send);
    await act(async () => retryButton()!.click());
    expect(retryButton()?.disabled).toBe(false);
    await act(async () => retryButton()!.click());
    expect(send).toHaveBeenCalledTimes(2);
  });

  it(`${surface}: excludes recovered failures and manual stops, and supports errors without details`, async () => {
    const send = vi.fn().mockResolvedValue(true);
    for (const status of ['completed', 'interrupted', 'inProgress']) {
      await render([failed, { id: 'latest', status, items: [] }], send);
      expect(retryButton()).toBeUndefined();
    }
    await render([{ ...failed, error: null }], send);
    expect(retryButton()?.disabled).toBe(false);
  });
}

it('offers one manual retry after the last capacity failure, outside the details toggle', async () => {
  const turn = restoreRequestErrors({ ...failed, error: { message: MODEL_CAPACITY_MESSAGE }, requestErrors: [
    { id: 'temporary', afterItemId: null, itemCount: 0, willRetry: true,
      error: { message: 'temporarily unavailable' } },
  ] });
  await act(async () => root.render(<TurnRetryProvider target={failedTurnTarget('thread', [turn])}
    disabled={false} onRetry={vi.fn().mockResolvedValue(true)}>
    <TurnMessage turn={turn} running={false} active />
  </TurnRetryProvider>));
  expect([...container.querySelectorAll('button')].filter(button => button.textContent === '重试')).toHaveLength(1);
  expect(container.querySelector('details button')).toBeNull();
});

it('unlocks only the acknowledged retry item after a definitive queue outcome', async () => {
  const send = vi.fn().mockResolvedValueOnce({ queueItemId: 'retry-item' })
    .mockResolvedValue({ queueItemId: 'next-retry-item' });
  const render = (releasedQueueItemIds: string[]) => act(async () => root.render(
    <TurnRetryProvider target={failedTurnTarget('thread', [failed])} disabled={false} onRetry={send}
      releasedQueueItemIds={releasedQueueItemIds}>
      <ChatTurnSummary turn={failed} onOpen={() => {}} />
    </TurnRetryProvider>));
  const button = () => [...container.querySelectorAll('button')].find(entry => /^(重试|正在重试…)$/.test(
    entry.textContent ?? ''))!;
  await render([]);
  await act(async () => button().click());
  await render(['unrelated-item']);
  expect(button().disabled).toBe(true);
  await act(async () => button().click());
  expect(send).toHaveBeenCalledOnce();
  await render(['retry-item']);
  expect(button().disabled).toBe(false);
  await render([]);
  expect(button().disabled).toBe(false);
  await act(async () => { button().click(); button().click(); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(button().disabled).toBe(true);
  await render(['retry-item']);
  expect(button().disabled).toBe(true);
  await render([]);
  expect(button().disabled).toBe(true);
});
