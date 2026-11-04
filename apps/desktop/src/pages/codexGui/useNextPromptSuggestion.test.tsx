// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { initialState } from './preferences';
import { testModels } from '../../../../../shared/conversation/testing/models';
import { useNextPromptSuggestion } from './useNextPromptSuggestion';
import type { GuiState } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
let root: Root;
let host: HTMLDivElement;
let state: GuiState;
let active: boolean;
let blocked: boolean;
function Fixture() {
  const suggestion = useNextPromptSuggestion(state, { active, blocked });
  return <button onClick={suggestion.dismiss}>{suggestion.text}</button>;
}
const render = () => act(async () => root.render(<StrictMode><Fixture /></StrictMode>));
const advance = (time = 500) => act(async () => { await vi.advanceTimersByTimeAsync(time); });
function deferred() {
  let resolve!: (value: { suggestion: string | null }) => void;
  const promise = new Promise<{ suggestion: string | null }>(done => { resolve = done; });
  vi.mocked(guiApi.request).mockReturnValueOnce(promise);
  return (text = '按方案实现') => act(async () => { resolve({ suggestion: text }); });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.request).mockResolvedValue({ suggestion: '按方案实现' });
  active = true; blocked = false;
  state = { ...initialState(), connection: 'ready', selected: 'one', models: testModels,
    settings: { cwd: '', model: 'gpt-test', effort: 'high', access: 'danger-full-access' },
    conversations: { one: { thread: { id: 'one', cwd: '', preview: '', updatedAt: 1 },
      turns: [{ id: 'turn', status: 'completed', items: [
        { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '先给出方案' }] },
        { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '方案已准备好' },
      ] }], activeTurn: null, tokens: 0, error: '' } } };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('requests once after a completed reply using the fastest supported effort', async () => {
  await render(); await advance(499); expect(guiApi.request).not.toHaveBeenCalled();
  await advance(1);
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'suggestNextPrompt',
    threadId: 'one', sourceTurnId: 'turn', model: 'gpt-test', effort: 'low' });
  expect(host.textContent).toBe('按方案实现');
  await render(); await advance(5_000); expect(guiApi.request).toHaveBeenCalledOnce();
});

it('typing before the debounce waits until the draft is cleared', async () => {
  await render(); await act(async () => { host.querySelector('button')!.click(); });
  blocked = true; await render();
  await advance(); expect(guiApi.request).not.toHaveBeenCalled();
  blocked = false; await render(); await advance();
  expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
});

it('saves a response during input and restores it when the draft is deleted', async () => {
  const resolve = deferred(); await render(); await advance();
  await act(async () => { host.querySelector('button')!.click(); });
  blocked = true; await render(); await resolve();
  expect(host.textContent).toBe('');
  blocked = false; await render(); await advance();
  expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
});

it.each(['inactive', 'switch', 'running', 'blocked'])(
  'retains a response after %s and returning to the same completed turn', async reason => {
    const resolve = deferred(); await render(); await advance();
    if (reason === 'inactive') active = false;
    if (reason === 'switch') state = { ...state, selected: null };
    if (reason === 'running') state.conversations.one.activeTurn = 'next';
    if (reason === 'blocked') blocked = true;
    await render(); await resolve();
    active = true; blocked = false; state.selected = 'one'; state.conversations.one.activeTurn = null;
    await render(); await advance();
    expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
  });

it.each(['loading', 'modelCatalogLoading', 'modelSettingsLoading'] as const)(
  'keeps the saved suggestion visible during %s', async field => {
    await render(); await advance();
    state[field] = true; await render(); await advance(30_000);
    expect(host.textContent).toBe('按方案实现');
    state[field] = false; await render(); await advance();
    expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
  });

it('restores the saved suggestion after remount without another prediction request', async () => {
  await render(); await advance();
  await act(async () => root.render(null));
  await render(); await advance();
  expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
});

it('keeps the same suggestion when the model changes without a new turn', async () => {
  await render(); await advance();
  state.models = [{ ...testModels[0], model: 'other-model' }]; state.settings.model = 'other-model';
  await render(); await advance();
  expect(host.textContent).toBe('按方案实现'); expect(guiApi.request).toHaveBeenCalledOnce();
});

it('hides the old suggestion as soon as a new turn starts', async () => {
  await render(); await advance();
  state.conversations.one.activeTurn = 'next';
  state.conversations.one.turns.push({ id: 'next', status: 'inProgress', items: [] });
  await render(); expect(host.textContent).toBe('');
});

it('discards the old response when a newer turn completes', async () => {
  const resolve = deferred(); await render(); await advance();
  state.conversations.one.turns = [{ ...state.conversations.one.turns[0], id: 'new-turn' }];
  vi.mocked(guiApi.request).mockResolvedValue({ suggestion: '检查实现结果' });
  await render(); await resolve(); expect(host.textContent).toBe('');
  await advance(); expect(host.textContent).toBe('检查实现结果');
});

it.each(['empty', 'commentary', 'running', 'failed', 'goal', 'approval', 'draft', 'loading', 'offline'])(
  'does not predict for %s', async reason => {
    if (reason === 'empty') state.conversations.one.turns = [];
    if (reason === 'commentary') state.conversations.one.turns[0].items[1].phase = 'commentary';
    if (reason === 'running') state.conversations.one.activeTurn = 'next';
    if (reason === 'failed') state.conversations.one.turns[0].status = 'failed';
    if (reason === 'goal') state.goals = { one: { threadId: 'one', objective: '完成项目', status: 'active',
      tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } };
    if (reason === 'approval') state.approvals = [{ method: 'approval', params: { threadId: 'one' } }];
    if (reason === 'draft') blocked = true;
    if (reason === 'loading') state.loading = true;
    if (reason === 'offline') state.connection = 'offline';
    await render(); await advance(); expect(guiApi.request).not.toHaveBeenCalled();
  });

it('handles unavailable predictions silently without repeated requests', async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('unavailable'));
  await render(); await advance(); await render(); await advance();
  expect(host.textContent).toBe(''); expect(guiApi.request).toHaveBeenCalledOnce();
});

it('ignores an outstanding response after unmount', async () => {
  const resolve = deferred(); await render(); await advance();
  await act(async () => root.render(null)); await resolve(); expect(host.textContent).toBe('');
});
