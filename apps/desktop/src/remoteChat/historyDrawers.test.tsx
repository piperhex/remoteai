// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DetailsWorkspace } from '../../../../shared/conversation/DetailsWorkspace';
import { useHistoryDrawers } from '../../../../shared/remote-chat/views/useHistoryDrawers';
import type { Turn } from '../../../../shared/remote-chat/views/types';

vi.mock('../../../../shared/task-review/views/TaskReviewPanel', () => ({
  TaskReviewPanel: () => <textarea aria-label="验收意见" defaultValue="" />,
}));
const turns: Turn[] = [{ id: 'turn', status: 'completed', items: [
  { id: 'change', type: 'fileChange', status: 'completed', changes: [] },
] }];
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
function History() {
  const drawers = useHistoryDrawers(turns);
  return <>
    <button onClick={() => drawers.open({ type: 'turn', id: 'turn', panel: 'result' })}>打开验收</button>
    <button onClick={() => drawers.open({ type: 'item', id: 'change' })}>打开修改</button>
    {drawers.panels}
  </>;
}
const click = (name: string) => act(async () => {
  const button = [...host.querySelectorAll('button')]
    .find(element => (element.getAttribute('aria-label') ?? element.textContent) === name)!;
  button.click();
});
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<DetailsWorkspace selected="thread" active><History /></DetailsWorkspace>));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('retains message drawers and review drafts across other details, closing and repeated entry clicks', async () => {
  await click('打开验收');
  const draft = host.querySelector('textarea')!;
  draft.value = '继续保留这条验收意见';
  await click('打开修改');
  expect(host.querySelectorAll('aside')).toHaveLength(1);
  expect(draft.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(true);
  await click('关闭详情抽屉');
  expect(host.querySelector('aside')?.hidden).toBe(true);
  await click('打开验收');
  expect(host.querySelector('textarea')).toBe(draft);
  expect(draft.value).toBe('继续保留这条验收意见');
  expect(draft.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(false);
  await click('打开修改'); await click('打开验收');
  expect(host.querySelectorAll('[aria-label="侧栏内容"] [role="tab"]')).toHaveLength(3);
});
