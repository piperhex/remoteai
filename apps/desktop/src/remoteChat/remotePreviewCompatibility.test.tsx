// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatDetailsWorkspace } from '../../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatFileContext } from '../../../../shared/remote-chat/views/ChatFileLink';
import type { FilePreviewContext } from '../../../../shared/remote-chat/views/ChatFilePreview';
import { ChatMarkdown } from '../../../../shared/remote-chat/views/ChatMarkdown';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../shared/conversation/fileEnvironment';
import { FileThreadContext, fileApi } from '../../../../shared/conversation/fileApi';
import { filePreviewApi } from '../../../../shared/file-preview/workspace/api';

let root: Root;
let host: HTMLDivElement;
let context: FilePreviewContext;
let environment: FileEnvironment;
const path = 'F:/remote/docs/verification.md';
const link = () => host.querySelector<HTMLButtonElement>(`button[aria-label="预览文件：${path}"]`)!;
const click = (element: HTMLElement) => act(async () => element.click());
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  .find(element => element.textContent === label)!;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  vi.spyOn(fileApi, 'applications').mockRejectedValue(new Error('Must not discover local applications'));
  vi.spyOn(fileApi, 'perform').mockRejectedValue(new Error('Must not open local files'));
  vi.spyOn(filePreviewApi, 'open').mockRejectedValue(new Error('Must not read local files'));
  context = { ready: true, threadId: 'remote-thread', client: { open: vi.fn(), read: vi.fn(), close: vi.fn() },
    load: vi.fn(async (_thread, filePath) => ({ path: filePath,
      text: filePath === path ? '# 验证报告\n\n[后续文档](next.md#L3)' : '# 后续内容' })) };
  environment = { remote: true,
    previews: { open: vi.fn().mockRejectedValue(new Error('Unsupported operation')), close: vi.fn() },
    actions: { applications: vi.fn(async () => []), perform: vi.fn(async target => ({ path: target.path, saved: false })) },
    resolveWebsite: vi.fn(), image: () => null,
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<FileEnvironmentContext.Provider value={environment}>
    <FileThreadContext.Provider value="remote-thread"><ChatFileContext.Provider value={context}>
      <ChatDetailsWorkspace selected="remote-thread" active enabled>
        <ChatMarkdown text={`[验证报告](${path})`} />
      </ChatDetailsWorkspace>
    </ChatFileContext.Provider></FileThreadContext.Provider>
  </FileEnvironmentContext.Provider>));
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(fileApi.applications).not.toHaveBeenCalled();
  expect(fileApi.perform).not.toHaveBeenCalled();
  expect(filePreviewApi.open).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(['unsupported', 'unavailable'])(
  'left-click previews remote content when desktop previews are %s, without opening the menu', async failure => {
    if (failure === 'unavailable') vi.mocked(environment.previews.open).mockResolvedValue(null);
    await click(link());
    expect(host.querySelector('[data-details-panel]')?.textContent).toContain('验证报告');
    expect(context.load).toHaveBeenCalledWith('remote-thread', path, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(environment.actions.applications).not.toHaveBeenCalled();
    expect(environment.actions.perform).not.toHaveBeenCalled();
  },
);

it('right-click opens actions without reading the file and offers a separate preview action', async () => {
  await act(async () => link().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  expect(menuItem('预览文件')).toBeTruthy();
  expect(menuItem('在远程电脑上打开')).toBeTruthy();
  expect(context.load).not.toHaveBeenCalled();
  expect(environment.previews.open).not.toHaveBeenCalled();
  await click(menuItem('预览文件'));
  expect(host.querySelector('[data-details-panel]')?.textContent).toContain('验证报告');
  expect(environment.actions.perform).not.toHaveBeenCalled();
});

it('keeps nested paths and preview history on the selected remote computer', async () => {
  await click(link());
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="预览文件：F:/remote/docs/next.md"]')!);
  expect(context.load).toHaveBeenLastCalledWith('remote-thread', 'F:/remote/docs/next.md', expect.any(Object));
  expect(host.querySelector('[data-details-panel]')?.textContent).toContain('引用位置：第 3 行');
  await click(host.querySelector<HTMLButtonElement>('button[aria-label="返回上一页"]')!);
  expect(context.load).toHaveBeenCalledTimes(2);
  expect(host.querySelector('.pm-browser-page:not([hidden])')?.textContent).toContain('验证报告');
});

it('keeps read errors inside the preview with download available instead of opening an application menu', async () => {
  vi.mocked(context.load!).mockRejectedValue(new Error('private remote filesystem detail'));
  await click(link());
  expect(host.querySelector('[data-details-panel]')?.textContent).toContain('暂时无法预览此文件');
  expect(host.textContent).not.toContain('private remote filesystem detail');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect([...host.querySelectorAll('button')].find(button => button.textContent === '下载')?.disabled).toBe(false);
});
