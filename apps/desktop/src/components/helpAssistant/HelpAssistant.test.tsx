// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import { HelpAssistant } from './HelpAssistant';
import { readImage } from '../../pages/codexGui/draftImages';
import { helpCopy } from './copy';
import { helpError, messageHistory, type HelpAvailability, type HelpMessage } from './types';
import type { DashboardPage } from '../dashboard/DashboardNavigation';

vi.mock('../../api/backend', () => ({ hasLocalBackend: true, invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));
vi.mock('../../pages/codexGui/draftImages', async (original) => ({
  ...await original<typeof import('../../pages/codexGui/draftImages')>(), readImage: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
const openCodex = vi.fn();
const unsubscribe = vi.fn();
let accountChanged: () => void;
let progress: (payload: { requestId: string; text: string }) => void;
let activity: (payload: { requestId: string; activity: string | null }) => void;
let availability: HelpAvailability;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
const imageUrl = 'data:image/png;base64,aW1hZ2U=';

async function attach(files = [new File(['image'], 'screenshot.png', { type: 'image/png' })]) {
  const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(picker, 'files', { configurable: true, value: files });
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
}

async function render(page: DashboardPage = 'accounts') {
  await act(async () => root.render(<HelpAssistant language="zh" page={page} onOpenCodex={openCodex} />));
}
async function open() { await act(async () => button('问题解答助手').click()); }
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function send() { await act(async () => button('发送').click()); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readImage).mockResolvedValue(imageUrl);
  availability = { status: 'ready', accountRevision: 7 };
  vi.mocked(invoke).mockImplementation(async (command) => command === 'remote_ai_help_status'
    ? availability : { text: '请打开 Codex，选择账户。', sources: ['docs/codex-gui.md'] });
  vi.mocked(subscribeGuiEvent).mockImplementation(async (name, callback) => {
    if (name === 'remote-ai-help-progress') progress = callback;
    else if (name === 'remote-ai-help-activity') activity = callback;
    else if (name === 'codex-gui-account-changed') accountChanged = () => callback({ kind: 'account', id: 'new-account' });
    return unsubscribe;
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('adds one quiet global launcher and preserves answers across sidebar pages', async () => {
  await render();
  expect(invoke).not.toHaveBeenCalled();
  expect(button('问题解答助手').querySelector('img')?.getAttribute('src')).toContain('assistant-icon.jpg');
  await open(); await type('怎么选择账户？'); await send();
  expect(document.body.textContent).toContain('请打开 Codex，选择账户。');
  await render('providers');
  expect(document.body.textContent).toContain('请打开 Codex，选择账户。');
  expect(document.querySelectorAll('[aria-label="问题解答助手"][role="dialog"]')).toHaveLength(1);
  expect(vi.mocked(invoke).mock.calls.find(([command]) => command === 'remote_ai_help_ask')?.[1]).toEqual({
    request: { question: '怎么选择账户？', page: 'accounts', history: [], accountRevision: 7,
      requestId: expect.any(String) },
  });
});

it.each(['zh', 'en', 'ru'] as const)('keeps the %s composer free of explanatory footer copy', async (language) => {
  const copy = helpCopy(language);
  await act(async () => root.render(<HelpAssistant language={language} page="accounts" onOpenCodex={openCodex} />));
  await act(async () => button(copy.title).click());
  expect(document.querySelector('form')?.textContent).toBe('');
  expect(input()).not.toBeNull();
  expect(button(copy.send)).not.toBeNull();
  expect(button(copy.send).parentElement).toBe(input().parentElement);
  expect(input().rows).toBe(1);
  await type('a');
  expect(input().rows).toBe(3);
  await type('');
  expect(input().rows).toBe(1);
});

it('sends image-only questions and includes images in follow-up history', async () => {
  await render(); await open(); await attach();
  expect(document.querySelector('form img')?.getAttribute('src')).toBe(imageUrl);
  expect(input().rows).toBe(3);
  await send();
  expect(vi.mocked(invoke).mock.calls.find(([command]) => command === 'remote_ai_help_ask')?.[1]).toMatchObject({
    request: { question: '', images: [imageUrl] },
  });
  expect(document.querySelector('[role="log"] img')?.getAttribute('src')).toBe(imageUrl);
  await type('more'); await send();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_ai_help_ask').at(-1)?.[1])
    .toMatchObject({ request: { history: [{ role: 'user', text: '', images: [imageUrl] },
      { role: 'assistant', text: expect.any(String) }] } });
});

it('restores images on model errors and allows removing them', async () => {
  await render(); await open(); await attach();
  vi.mocked(invoke).mockRejectedValueOnce('modelUnsupported');
  await send();
  expect(document.querySelector('form img')).not.toBeNull();
  expect(document.body.textContent).toContain(helpCopy('zh').errors.modelUnsupported);
  await act(async () => button('移除图片 1').click());
  expect(document.querySelector('form img')).toBeNull();
  expect(button('发送').disabled).toBe(true);
});

it('rejects unsupported, oversized and excessive images before reading', async () => {
  await render(); await open();
  await attach([new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })]);
  expect(document.body.textContent).toContain(helpCopy('zh').imageErrors.imageType);
  const large = new File(['image'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 6 * 1024 * 1024 });
  await attach([large]);
  expect(document.body.textContent).toContain(helpCopy('zh').imageErrors.imageSize);
  await attach(Array.from({ length: 5 }, () => new File(['image'], 'small.png', { type: 'image/png' })));
  expect(document.body.textContent).toContain(helpCopy('zh').imageErrors.imageCount);
  expect(readImage).not.toHaveBeenCalled();
});

it('pastes images, blocks sending while reading, and preserves the draft when minimized', async () => {
  let finish!: (value: string) => void;
  vi.mocked(readImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await render(); await open(); await type('question');
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [new File(['image'], 'clipboard.png', { type: 'image/png' })] },
  });
  await act(async () => input().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(button('发送').disabled).toBe(true);
  await act(async () => button('收起助手').click());
  await act(async () => finish(imageUrl));
  await open();
  expect(document.querySelector('form img')).not.toBeNull();
  expect(input().value).toBe('question');
});

it('opens account selection without submitting a request', async () => {
  availability = { status: 'accountRequired' };
  await render(); await open();
  expect(input().disabled).toBe(true);
  const setup = [...document.querySelectorAll('button')].find((item) => item.textContent === '选择账户')!;
  await act(async () => setup.click());
  expect(openCodex).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.every(([command]) => command !== 'remote_ai_help_ask')).toBe(true);
});

it('keeps a single request running while minimized and hides remote Markdown images and links', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === 'remote_ai_help_questions' ? Promise.resolve(null) : command === 'remote_ai_help_status'
    ? Promise.resolve(availability) : new Promise((resolve) => { finish = resolve; }));
  await render(); await open(); await type('Remote AI 如何使用？');
  await act(async () => { button('发送').click(); button('发送').click(); });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_ai_help_ask')).toHaveLength(1);
  await act(async () => button('收起助手').click());
  await render('tokens'); await open();
  expect(document.body.textContent).toContain('正在查找答案');
  await act(async () => finish({ text: '**可以**\n![track](https://example.com/pixel)\n[link](file:///secret)', sources: [] }));
  expect(document.querySelector('[role="log"] strong')?.textContent).toBe('可以');
  expect(document.querySelector('[role="log"] img')).toBeNull();
  expect(document.querySelector('[role="log"] a')).toBeNull();
});

it('restores the draft after failure without leaking backend error details', async () => {
  await render(); await open(); await type('为什么连不上？');
  vi.mocked(invoke).mockRejectedValueOnce('upstream secret-token C:/private/config');
  await send();
  expect(input().value).toBe('为什么连不上？');
  expect(document.body.textContent).toContain('暂时没有获取到答案');
  expect(document.body.textContent).not.toContain('secret-token');
  await send();
  expect(document.body.textContent).toContain('请打开 Codex');
  await act(async () => button('新对话').click());
  expect(document.querySelector('[role="log"]')?.textContent).toBe('');
});

it('does not submit during IME composition or Shift+Enter', async () => {
  await render(); await open(); await type('你好');
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  });
  expect(vi.mocked(invoke).mock.calls.every(([command]) => command !== 'remote_ai_help_ask')).toBe(true);
});

it('clears old-account history even when the account changes while minimized', async () => {
  await render(); await open(); await type('第一个问题'); await send();
  await act(async () => button('收起助手').click());
  expect(unsubscribe).toHaveBeenCalled();
  availability = { status: 'ready', accountRevision: 8 };
  await open();
  expect(document.querySelector('[role="log"]')?.textContent).toBe('');
  await type('第二个问题'); await send();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_ai_help_ask').at(-1)?.[1]).toEqual({
    request: { question: '第二个问题', page: 'accounts', history: [], accountRevision: 8,
      requestId: expect.any(String) },
  });
});

it('discards answers from an account that changed during the request', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === 'remote_ai_help_questions' ? Promise.resolve(null) : command === 'remote_ai_help_status'
    ? Promise.resolve(availability) : new Promise((resolve) => { finish = resolve; }));
  await render(); await open(); await type('问题'); await send();
  availability = { status: 'ready', accountRevision: 8 };
  await act(async () => accountChanged());
  await act(async () => finish({ text: '旧账户回答', sources: [] }));
  expect(document.body.textContent).not.toContain('旧账户回答');
  expect(input().value).toBe('问题');
  expect(document.body.textContent).toContain('账户已切换');
});

it('bounds submitted history and maps unknown errors to safe copy', () => {
  const messages: HelpMessage[] = Array.from({ length: 40 }, (_, id) => ({
    id, role: id % 2 ? 'assistant' : 'user', text: '界'.repeat(8_000),
  }));
  expect(messageHistory(messages)).toHaveLength(4);
  expect(messageHistory(messages)[0]).not.toHaveProperty('id');
  expect(helpError({ message: 'secret' })).toBe('answerFailed');
  expect(helpError(new Error('accountRequired'))).toBe('accountRequired');
});

function activeRequestId() {
  const args = vi.mocked(invoke).mock.calls.find(([command]) => command === 'remote_ai_help_ask')?.[1];
  return (args?.request as { requestId: string }).requestId;
}

it('streams before completion, keeps progress while dismissed, and marks the completed answer unread', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === 'remote_ai_help_questions' ? Promise.resolve(null) : command === 'remote_ai_help_status'
    ? Promise.resolve(availability) : new Promise((resolve) => { finish = resolve; }));
  await render(); await open(); await type('怎么使用？'); await send();
  const requestId = activeRequestId();
  await act(async () => progress({ requestId: 'another-request', text: '别的回答' }));
  expect(document.body.textContent).not.toContain('别的回答');
  await act(async () => progress({ requestId, text: '**逐步**生成' }));
  expect(document.querySelector('[role="log"] strong')?.textContent).toBe('逐步');
  expect(button('停止').disabled).toBe(false);
  await act(async () => input().dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => container.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[aria-label="有新回答"]')).toBeNull();
  await act(async () => progress({ requestId, text: '**逐步**生成的内容' }));
  await open();
  expect(document.querySelector('[role="log"]')?.textContent).toContain('逐步生成的内容');
  await act(async () => button('收起助手').click());
  await act(async () => finish({ text: '完整回答', sources: ['docs/help-assistant.md'] }));
  expect(document.querySelector('[aria-label="有新回答"]')).not.toBeNull();
  await open();
  expect(document.querySelector('[aria-label="有新回答"]')).toBeNull();
  expect(document.querySelector('[role="log"]')?.textContent).toContain('完整回答');
  expect(document.querySelector('[role="log"]')?.textContent).not.toContain('逐步生成');
  expect(document.querySelector('[role="log"] details')?.textContent).toContain('docs/help-assistant.md');
});

it.each(['failed', 'accountChanged'] as const)('does not mark a %s stream as a new answer', async (outcome) => {
  let finish!: (value: unknown) => void;
  let reject!: (reason: string) => void;
  vi.mocked(invoke).mockImplementation((command) => command === 'remote_ai_help_questions' ? Promise.resolve(null) : command === 'remote_ai_help_status'
    ? Promise.resolve(availability) : new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
  await render(); await open(); await type('保留问题'); await send();
  const requestId = activeRequestId();
  await act(async () => progress({ requestId, text: '未完成内容' }));
  await act(async () => button('收起助手').click());
  if (outcome === 'failed') await act(async () => reject('answerFailed'));
  else {
    availability = { status: 'ready', accountRevision: 8 };
    await act(async () => accountChanged());
    await act(async () => progress({ requestId, text: '过时内容' }));
    await act(async () => finish({ text: '过时内容', sources: [] }));
  }
  expect(document.querySelector('[aria-label="有新回答"]')).toBeNull();
  await open();
  expect(document.querySelector('[role="log"]')?.textContent).toBe('');
  expect(input().value).toBe('保留问题');
});

it('does not show an unread dot for answers completed while open', async () => {
  await render(); await open(); await type('问题'); await send();
  await act(async () => button('收起助手').click());
  expect(document.querySelector('[aria-label="有新回答"]')).toBeNull();
});

it('loads administrator questions and sends a clicked question immediately only once', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'remote_ai_help_status') return availability;
    if (command === 'remote_ai_help_questions') return [{ zh: '帮我检查设置', en: 'Check my settings' }];
    return new Promise((resolve) => { finish = resolve; });
  });
  await render(); await open();
  expect(document.body.textContent).not.toContain('如何选择 Codex 使用的账户？');
  const question = [...document.querySelectorAll('button')].find((item) => item.textContent === '帮我检查设置')!;
  await act(async () => { question.click(); question.click(); });
  const asks = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_ai_help_ask');
  expect(asks).toHaveLength(1);
  expect(asks[0][1]).toMatchObject({ request: { question: '帮我检查设置' } });
  expect(input().value).toBe('');
  await act(async () => finish({ text: '检查完成', sources: [] }));
});

it('respects an empty configured question list', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === 'remote_ai_help_status' ? availability : []);
  await render(); await open();
  for (const question of helpCopy('zh').questions) expect(document.body.textContent).not.toContain(question);
});

it('shows tool activity and stops only the active help request', async () => {
  let reject!: (reason: string) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'remote_ai_help_status') return availability;
    if (command === 'remote_ai_help_questions') return null;
    if (command === 'remote_ai_help_cancel') { reject('cancelled'); return; }
    return new Promise((_, fail) => { reject = fail; });
  });
  await render(); await open(); await type('帮我查看界面'); await send();
  const requestId = activeRequestId();
  await act(async () => activity({ requestId: 'unrelated', activity: 'computer' }));
  expect(document.body.textContent).not.toContain(helpCopy('zh').operating);
  await act(async () => activity({ requestId, activity: 'computer' }));
  expect(document.body.textContent).toContain(helpCopy('zh').operating);
  await act(async () => button('停止').click());
  expect(invoke).toHaveBeenCalledWith('remote_ai_help_cancel', { requestId });
  expect(document.body.textContent).toContain(helpCopy('zh').errors.cancelled);
  expect(input().disabled).toBe(false);
  expect(button('发送')).not.toBeNull();
});
