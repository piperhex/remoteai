// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatDetailsWorkspace } from '../../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatFileContext } from '../../../../shared/remote-chat/views/ChatFileLink';
import type { FilePreviewContext } from '../../../../shared/remote-chat/views/ChatFilePreview';
import { ChatMarkdown } from '../../../../shared/remote-chat/views/ChatMarkdown';
import { filePreviewApi } from '../../../../shared/file-preview/workspace/api';
import { DetailsContext } from '../../../../shared/conversation/detailsContext';
import { changedFiles } from '../../../../shared/conversation/diff';

let root: Root;
let host: HTMLDivElement;
let context: FilePreviewContext;
const panel = () => host.querySelector<HTMLElement>('aside[data-details-panel]');
const content = () => host.querySelector('.website-preview-browser');
const click = (name: string) => act(async () => {
  const button = [...host.querySelectorAll('button')]
    .find(element => (element.getAttribute('aria-label') ?? element.textContent) === name);
  expect(button).toBeDefined(); button!.click();
});
function Fixture({ selected = 'remote-thread', active = true }: { selected?: string; active?: boolean }) {
  return <ChatFileContext.Provider value={{ ...context, threadId: selected }}>
    <ChatDetailsWorkspace selected={selected} active={active} enabled>
      <ChatMarkdown text={'[交接文档](F:/remote/docs/handoff.md)\n\n[另一份](F:/remote/other.md)'} />
      <AppliedChanges />
    </ChatDetailsWorkspace>
  </ChatFileContext.Provider>;
}
function AppliedChanges() {
  const details = useContext(DetailsContext)!;
  return <button onClick={() => details.open({ id: 'edit', title: 'Applied edit',
    files: changedFiles([{ path: 'example.ts', kind: { type: 'add' }, diff: 'export const value = 1;\n' }]),
  })}>打开修改</button>;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  vi.spyOn(filePreviewApi, 'open').mockRejectedValue(new Error('Must not read a local file'));
  vi.spyOn(filePreviewApi, 'close').mockResolvedValue();
  context = { ready: true, threadId: 'remote-thread', client: {
    open: vi.fn(), read: vi.fn(), close: vi.fn(),
  }, load: vi.fn(async (_threadId, path) => ({ path,
    text: path.endsWith('handoff.md') ? '# 远程交接文档\n\n[后续文档](next.md#L3)' : '# 后续内容' })) };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('opens remote Markdown in the shared drawer and navigates nested links on the same computer', async () => {
  await click('交接文档');
  expect(panel()?.hidden).toBe(false);
  expect(content()?.textContent).toContain('远程交接文档');
  expect(document.querySelector('[role="dialog"]')).toBe(panel());
  expect(context.load).toHaveBeenLastCalledWith('remote-thread', 'F:/remote/docs/handoff.md', expect.any(Object));
  await click('后续文档');
  expect(host.querySelectorAll('aside')).toHaveLength(1);
  expect(context.load).toHaveBeenLastCalledWith('remote-thread', 'F:/remote/docs/next.md', expect.any(Object));
  expect(content()?.textContent).toContain('引用位置：第 3 行');
  await click('后退');
  expect(content()?.textContent).toContain('远程交接文档');
  await click('前进');
  expect(content()?.textContent).toContain('后续内容');
  expect(filePreviewApi.open).not.toHaveBeenCalled();
  expect(filePreviewApi.close).not.toHaveBeenCalled();
});

it('retains source mode across drawer controls and clears the preview on conversation changes', async () => {
  await click('交接文档'); await click('原文');
  await click('打开修改'); await click('浏览器');
  expect(content()?.querySelector('pre')?.textContent).toContain('# 远程交接文档');
  await click('最小化详情抽屉'); expect(panel()?.hidden).toBe(true);
  await click('恢复预览'); expect(panel()?.hidden).toBe(false);
  await act(async () => root.render(<Fixture active={false} />));
  expect(panel()?.hidden).toBe(true);
  await act(async () => root.render(<Fixture selected="another-thread" />));
  expect(panel()).toBeNull();
  await click('交接文档');
  expect(context.load).toHaveBeenLastCalledWith('another-thread', 'F:/remote/docs/handoff.md', expect.any(Object));
  await click('关闭详情抽屉'); expect(panel()?.hidden).toBe(true);
});

it('finishes a remote read while hidden and retains it when reopening the drawer', async () => {
  let resolve!: (value: { path: string; text: string }) => void;
  vi.mocked(context.load!).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await click('交接文档');
  expect(content()?.textContent).toContain('正在读取文件');
  const options = vi.mocked(context.load!).mock.calls[0][2];
  await click('关闭详情抽屉');
  expect(options?.signal?.aborted).toBe(false);
  await act(async () => resolve({ path: 'F:/remote/docs/handoff.md', text: '# Late' }));
  expect(panel()?.hidden).toBe(true);
  await click('交接文档');
  expect(content()?.textContent).toContain('Late');
  expect(context.load).toHaveBeenCalledOnce();
});

it('shows remote load failures in the drawer and keeps download available', async () => {
  vi.mocked(context.load!).mockRejectedValueOnce(new Error('private remote path'));
  await click('交接文档');
  expect(content()?.textContent).toContain('暂时无法预览此文件');
  expect(content()?.textContent).not.toContain('private remote path');
  expect([...content()!.querySelectorAll('button')].find(button => button.textContent === '下载')?.disabled).toBe(false);
});
