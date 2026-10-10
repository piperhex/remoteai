// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitToolbar } from '../../../web/src/chat/git/GitToolbar';
import { useRemoteGit } from '../../../../shared/remote-chat/useRemoteGit';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';

let root: Root;
let host: HTMLDivElement;
let client: ReturnType<typeof createAsyncGitFixture>;
const updateHint = '获取远程更新，无冲突时自动合并并提交。';

function Fixture() {
  const panel = useRemoteGit({ client, cwd: '/project', connected: true, active: true });
  return <GitToolbar panel={panel} connected />;
}
function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === label)!;
  return act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = createAsyncGitFixture();
  client.action = vi.fn().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it('shows automatic merge for update even after choosing rebase for pull', async () => {
  const changes = await client.changes('/project');
  client.changes = async () => ({ ...changes, files: [] });
  await act(async () => root.render(<Fixture />));
  await click('同步');
  expect(host.textContent).toContain(updateHint);
  expect(host.querySelector('select')).toBeNull();
  await click('拉取 Pull');
  const strategy = host.querySelector('select')!;
  await act(async () => { strategy.value = 'rebase'; strategy.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('更新项目');
  expect(host.querySelector('select')).toBeNull();
  await click('执行 更新项目');
  expect(client.action).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'update', strategy: 'merge' }));
  await click('同步');
  await click('拉取 Pull');
  expect(host.querySelector('select')?.value).toBe('rebase');
});

it('keeps update disabled when there are local changes', async () => {
  await act(async () => root.render(<Fixture />));
  await click('同步');
  expect(host.textContent).toContain('请先提交本地改动，再拉取或更新项目。');
  await click('执行 更新项目');
  expect(client.action).not.toHaveBeenCalled();
});
