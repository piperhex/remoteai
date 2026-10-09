// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitDiff } from '../../../web/src/chat/git/GitDiff';
import { DetailsWorkspace } from '../pages/codexGui/DetailsWorkspace';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import type { GitClient, GitDiff as DiffValue } from '../../../../shared/remote-chat/gitTypes';

let root: Root;
let host: HTMLDivElement;
let client: GitClient;
const patch = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n'
  + '@@ -3 +3,2 @@\n-const value = 1;\n+const value = 2;\n+run(value);\n';
const detail = (path: string) => ({ kind: 'diff' as const, path, title: path });
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const panel = () => host.querySelector<HTMLElement>('aside[aria-label="文件更改详情"]');
function render(path = 'src/app.ts') {
  return act(async () => root.render(<DetailsWorkspace active selected="/project">
    <GitDiff key={path} client={client} cwd="/project" detail={detail(path)} enabled desktop onBack={() => {}} />
  </DetailsWorkspace>));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element));
  localStorage.clear();
  client = createAsyncGitFixture();
  client.diff = vi.fn().mockResolvedValue({ text: patch, truncated: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('uses highlighted file review, copies the patch and preserves split mode when minimized', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await render();
  expect(panel()?.textContent).toContain('+2−1');
  expect(panel()?.querySelector('.hljs-keyword')?.textContent).toBe('const');
  await act(async () => button('复制 diff').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(patch);
  const split = [...host.querySelectorAll('button')].find(element => element.textContent === '并排')!;
  await act(async () => split.click());
  await act(async () => button('最小化详情抽屉').click());
  expect(panel()?.hidden).toBe(true);
  const restore = [...host.querySelectorAll('button')].find(element => element.textContent === '恢复文件更改')!;
  await act(async () => restore.click());
  expect(split.getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('关闭详情抽屉').click());
  expect(panel()).toBeNull();
});

it('ignores late diffs after selecting another file and does not reopen a closed review', async () => {
  let finish!: (value: DiffValue) => void;
  vi.mocked(client.diff).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render('slow.ts');
  expect(panel()).toBeNull();
  await render();
  expect(panel()?.textContent).toContain('src/app.ts');
  await act(async () => button('关闭详情抽屉').click());
  await act(async () => finish({ text: patch.replaceAll('src/app.ts', 'slow.ts'), truncated: false }));
  expect(panel()).toBeNull();
});

it('keeps truncation notices and handles files without text changes', async () => {
  vi.mocked(client.diff).mockResolvedValueOnce({ text: patch, truncated: true });
  await render();
  expect(panel()?.textContent).toContain('差异较大，仅显示部分内容。');
  vi.mocked(client.diff).mockResolvedValueOnce({ text: '', truncated: false });
  await render('empty.txt');
  expect(panel()?.textContent).toContain('empty.txt');
  expect(panel()?.textContent).toContain('此文件没有可显示的文本差异。');
});
