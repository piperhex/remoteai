// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../../web/src/chat/ChatComposer';
import { draftImage, MAX_CHAT_IMAGE_CHARS } from '../../../../shared/remote-chat/attachments';

const mocks = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock('../../../web/src/chat/pickChatImages', () => ({ pickChatImages: mocks.pick }));
vi.mock('../../../web/src/components/AdaptiveSheet', () => ({
  AdaptiveSheet: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));
const url = 'data:image/jpeg;base64,aW1hZ2U=';
let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof ChatComposer>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  props = { models: [], selection: { model: 'astra', effort: 'high', access: 'workspace-write' },
    connection: { deviceName: '测试电脑', chooseDevice: vi.fn(), client: {
      read: vi.fn().mockResolvedValue({ selection: { kind: 'none' }, choices: [], running: false }),
      select: vi.fn(), subscribe: vi.fn(() => vi.fn()),
    } },
    readUsage: vi.fn(),
    readConversationMetrics: vi.fn(),
    contextSettings: { read: vi.fn(), write: vi.fn() }, goals: { load: vi.fn(), clear: vi.fn() }, goalBusy: false,
    catalog: { skills: [], loaded: true, loading: false, error: '', refresh: vi.fn() }, cwd: '',
    compactReason: null, compacting: false, compact: vi.fn(), loadCatalog: vi.fn(), loadFiles: vi.fn(),
    loadConversations: vi.fn(),
    settingsBusy: false, settingsError: '', updateSettings: vi.fn(), active: true, ready: true,
    sending: false, running: false, threadId: null, send: vi.fn().mockResolvedValue(true), interrupt: vi.fn() };
  mocks.pick.mockReset().mockImplementation(async () => [draftImage(url)]);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(update: Partial<typeof props> = {}) {
  props = { ...props, ...update };
  await act(async () => root.render(<ChatComposer {...props} />));
}
function button(label: string) { return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); }
async function choose() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['photo'], 'photo.jpg')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function type(text: string) {
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows separate progress inside each photo and restores the draft controls after failure', async () => {
  mocks.pick.mockResolvedValueOnce([draftImage(url), draftImage(url)]);
  await render(); await choose();
  await render({ sending: true, uploadProgress: { phase: 'uploading', percent: 61, items: [
    { kind: 'image', index: 0, percent: 100 }, { kind: 'image', index: 1, percent: 22 },
  ] } });
  const previews = container.querySelectorAll('.chat-attachment-preview');
  expect(previews[0].querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  expect(previews[1].querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('22');
  expect(previews[0].textContent).toContain('已上传');
  expect(container.querySelector('.chat-upload-progress')).toBeNull();
  expect(button('移除图片 1')!.disabled).toBe(true);
  await render({ ready: false });
  expect(previews[1].textContent).toContain('等待连接');
  expect(previews[0].textContent).toContain('已上传');
  await render({ sending: false, uploadProgress: undefined, ready: true });
  expect(container.querySelectorAll('img')).toHaveLength(2);
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(button('移除图片 1')!.disabled).toBe(false);
});

it('opens the album from an empty composer, previews, removes and sends an image without text', async () => {
  await render();
  expect(button('发送消息')!.disabled).toBe(true);
  await act(async () => button('添加内容')!.click());
  const album = Array.from(container.querySelectorAll<HTMLButtonElement>('.chat-add-menu button'))
    .find(element => element.textContent === '相册')!;
  expect(album.textContent).toContain('相册');
  const picker = vi.spyOn(container.querySelector<HTMLInputElement>('input')!, 'click');
  await act(async () => album.click());
  expect(picker).toHaveBeenCalledOnce();
  await choose();
  expect(container.querySelector('img')?.src).toBe(url);
  expect(button('发送消息')!.disabled).toBe(false);
  await act(async () => button('移除图片 1')!.click());
  expect(button('添加内容')).not.toBeNull();
  await choose();
  await act(async () => button('发送消息')!.click());
  expect(props.send).toHaveBeenCalledWith({ text: '', images: [url], ...props.selection });
  expect(container.querySelector('img')).toBeNull();
});

it('keeps photos after a failed first send creates a thread, and permits retry', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }))
    .mockResolvedValue(true);
  await render({ send });
  await choose();
  await act(async () => button('发送消息')!.click());
  await render({ threadId: 'created', sending: true });
  expect(container.querySelector('img')).not.toBeNull();
  await act(async () => finish(false));
  await render({ sending: false });
  expect(container.querySelector('img')).not.toBeNull();
  await act(async () => button('发送消息')!.click());
  expect(send).toHaveBeenCalledTimes(2);
  expect(container.querySelector('img')).toBeNull();
});

it('supports mixed text and photos while replying, and clears the draft when switching chats', async () => {
  await render({ running: true });
  await choose(); await type('看看这张图');
  await act(async () => button('发送消息')!.click());
  expect(props.send).toHaveBeenCalledWith({ text: '看看这张图', images: [url], ...props.selection });
  await choose(); await type('尚未发送');
  await render({ threadId: 'another' });
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('textarea')!.value).toBe('');
});

it('keeps existing photos on cancellation and oversized selection, and blocks sends while preparing', async () => {
  await render(); await choose();
  mocks.pick.mockResolvedValueOnce([]);
  await choose();
  expect(container.querySelectorAll('img')).toHaveLength(1);
  mocks.pick.mockResolvedValueOnce([{ id: 'large', url: 'x'.repeat(MAX_CHAT_IMAGE_CHARS) }]);
  await choose();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('图片较大');
  expect(container.querySelectorAll('img')).toHaveLength(1);
  let finish!: (images: ReturnType<typeof draftImage>[]) => void;
  mocks.pick.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await choose();
  expect(button('发送消息')!.disabled).toBe(true);
  await render({ threadId: 'other' });
  await act(async () => finish([draftImage(url)]));
  expect(container.querySelector('img')).toBeNull();
});

it('pauses with no draft, continues after interruption, and sends a photo draft without pausing', async () => {
  await render({ running: true });
  await act(async () => button('暂停生成')!.click());
  expect(props.interrupt).toHaveBeenCalledOnce();
  expect(props.send).not.toHaveBeenCalled();
  await render({ running: false, interrupted: true });
  await act(async () => button('继续生成')!.click());
  expect(props.send).toHaveBeenCalledWith({ text: '请继续完成刚才中断的任务。', images: [], ...props.selection });
  await render({ running: true, interrupted: false });
  await choose();
  await act(async () => button('发送消息')!.click());
  expect(props.interrupt).toHaveBeenCalledOnce();
  expect(props.send).toHaveBeenLastCalledWith({ text: '', images: [url], ...props.selection });
});
