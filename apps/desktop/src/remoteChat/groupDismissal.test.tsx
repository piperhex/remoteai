// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGroupingUI, type GroupingUI } from '../../../../shared/chat/groups/context';
import { GROUPS_UNSUPPORTED_ERROR, type GroupClient, type GroupMember } from '../../../../shared/chat/groups/model';
import { defaultText } from '../../../../shared/localization/messages';

let root: Root;
let container: HTMLDivElement;
let model: GroupingUI;
const client: GroupClient = { members: vi.fn(), mutate: vi.fn() };
function Harness() {
  model = useGroupingUI({ client, translate: defaultText, ready: true });
  return null;
}
function pendingMembers() {
  let resolve!: (members: GroupMember[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<GroupMember[]>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it.each(['client.groups.loadFailed', GROUPS_UNSUPPORTED_ERROR])('dismisses the manager and its error: %s', async error => {
  vi.mocked(client.members).mockRejectedValue(new Error(error));
  await act(async () => model.openManager());
  expect(model.error).toBe(error);
  await act(async () => model.closeManager());
  expect(model.managerOpen).toBe(false);
  expect(model.error).toBe('');
  expect(model.loading).toBe(false);
});

it.each(['resolve', 'reject'] as const)('ignores a load that finishes after closing: %s', async completion => {
  const load = pendingMembers();
  vi.mocked(client.members).mockReturnValue(load.promise);
  await act(async () => model.openManager());
  expect(model.loading).toBe(true);
  await act(async () => model.closeManager());
  await act(async () => {
    if (completion === 'reject') load.reject(new Error(GROUPS_UNSUPPORTED_ERROR));
    else load.resolve([{ kind: 'project', id: '/old', cwd: '/old', title: 'Old' }]);
  });
  expect(model.error).toBe('');
  expect(model.members).toEqual([]);
  expect(model.managerOpen).toBe(false);
  expect(model.loading).toBe(false);
});

it('keeps a reopened manager isolated from the previous request', async () => {
  const old = pendingMembers();
  const fresh = pendingMembers();
  vi.mocked(client.members).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await act(async () => model.openManager());
  await act(async () => model.closeManager());
  await act(async () => model.openManager());
  await act(async () => old.reject(new Error(GROUPS_UNSUPPORTED_ERROR)));
  expect(model.error).toBe('');
  expect(model.loading).toBe(true);
  const rows: GroupMember[] = [{ kind: 'project', id: '/new', cwd: '/new', title: 'New' }];
  await act(async () => fresh.resolve(rows));
  expect(model.managerOpen).toBe(true);
  expect(model.members).toEqual(rows);
  expect(model.loading).toBe(false);
});

it('still surfaces mutation failures from the standalone move picker', async () => {
  vi.mocked(client.mutate).mockRejectedValue(new Error(GROUPS_UNSUPPORTED_ERROR));
  await act(async () => { await model.assign([{ kind: 'project', id: '/project' }], null); });
  expect(model.managerOpen).toBe(false);
  expect(model.error).toBe(GROUPS_UNSUPPORTED_ERROR);
});
