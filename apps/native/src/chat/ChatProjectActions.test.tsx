import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatProjectActions } from './ChatProjectActions';
import { useProjectActions, type ProjectActionsModel } from '../../../../shared/remote-chat/client/useProjectActions';
import { initialChatState } from './types';
import { useGrouping } from '../../../../shared/chat/groups/context';
vi.mock('../../../../shared/chat/groups/context', () => ({ useGrouping: vi.fn(() => null) }));

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock('react', async original => ({ ...await original<typeof React>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View',
  Platform: { OS: 'android' }, StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
beforeEach(() => { hooks.cursor = 0; hooks.values = []; vi.stubGlobal('React', React);
  vi.mocked(useGrouping).mockReturnValue(null); });
afterEach(() => vi.unstubAllGlobals());

interface NodeProps { children?: ReactNode; onPress?: () => void; disabled?: boolean }
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<NodeProps>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
function model(patch: Partial<ProjectActionsModel> = {}): ProjectActionsModel {
  return { target: { cwd: '/project', label: '项目名称' }, pinned: false, confirmRemove: false,
    error: '', busy: false, reason: '', open: vi.fn(), close: vi.fn(), confirm: vi.fn(), submit: vi.fn(), ...patch };
}

it('shows pinned state, uses a compact sheet and requires confirmation before removal', () => {
  const actions = model({ pinned: true });
  const sheet = ChatProjectActions({ actions })!;
  expect(sheet.props.maxWidth).toBe(400);
  expect(sheet.props.title).toBe('管理项目：项目名称');
  expect(nodes(sheet).some(node => node.props.children === '取消置顶')).toBe(true);
  nodes(sheet).filter(node => node.props.onPress)[1].props.onPress!();
  expect(actions.confirm).toHaveBeenCalledWith(true);
  expect(actions.submit).not.toHaveBeenCalled();
  const confirmation = ChatProjectActions({ actions: { ...actions, confirmRemove: true } })!;
  expect(confirmation.props.title).toBe('移除这个项目？');
  confirmation.props.onBack();
  expect(actions.confirm).toHaveBeenCalledWith(false);
  confirmation.props.actions[1].onPress();
  expect(actions.submit).toHaveBeenCalledWith('remove');
});

it('disables busy and offline actions while preserving errors for retry', () => {
  const offline = ChatProjectActions({ actions: model({ reason: 'client.errors.connectToYourComputerFirst' }) })!;
  expect(nodes(offline).filter(node => node.props.onPress).every(node => node.props.disabled)).toBe(true);
  const busy = ChatProjectActions({ actions: model({ busy: true, confirmRemove: true }) })!;
  expect(busy.props.dismissible).toBe(false);
  expect(busy.props.actions.every((action: { disabled: boolean }) => action.disabled)).toBe(true);
  const failed = ChatProjectActions({ actions: model({ error: '操作未完成，请稍后重试。' }) })!;
  expect(nodes(failed).some(node => node.props.children === '操作未完成，请稍后重试。')).toBe(true);
});

it('opens the shared group picker with the project path and closes the action sheet', () => {
  const setMoveTarget = vi.fn();
  vi.mocked(useGrouping).mockReturnValue({ ready: true, setMoveTarget } as unknown as ReturnType<typeof useGrouping>);
  const actions = model();
  const sheet = ChatProjectActions({ actions })!;
  nodes(sheet).find(node => nodes(node.props.children).some(child => child.props.children === '移动到分组')
    && node.props.onPress)?.props.onPress?.();
  expect(setMoveTarget).toHaveBeenCalledWith({ kind: 'project', id: '/project' });
  expect(actions.close).toHaveBeenCalledOnce();
});

it('serializes project submissions, retains failed targets and rejects the recent group', async () => {
  const run = vi.fn<(...args: [string, 'pin' | 'unpin' | 'remove']) => Promise<void>>();
  let finish: () => void = () => {};
  run.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const render = () => {
    hooks.cursor = 0;
    return useProjectActions({ ...initialChatState(), ready: true }, { projectActions: { run } });
  };
  render().open({ cwd: '', label: '最近' });
  expect(render().target).toBeNull();
  render().open({ cwd: '/project', label: '项目名称' });
  const pending = render().submit('pin');
  await render().submit('pin'); render().close();
  expect(run).toHaveBeenCalledTimes(1);
  expect(render().target?.cwd).toBe('/project');
  finish(); await pending;
  expect(render().target).toBeNull();
  run.mockRejectedValueOnce(new Error('操作未完成，请稍后重试。')).mockResolvedValueOnce();
  render().open({ cwd: '/other', label: '其他项目' });
  await render().submit('remove');
  expect(render().error).toBe('操作未完成，请稍后重试。');
  expect(render().target?.cwd).toBe('/other');
  await render().submit('remove');
  expect(run).toHaveBeenLastCalledWith('/other', 'remove');
  expect(render().target).toBeNull();
});
