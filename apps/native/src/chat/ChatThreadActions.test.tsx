import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatThreadActions } from './ChatThreadActions';
import { ChatThreadList } from './ChatThreadList';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { initialChatState, type Thread } from './types';
import type { ChatController } from './controller';
import { useGrouping } from '../../../../shared/chat/groups/context';
vi.mock('../../../../shared/chat/groups/context', () => ({ useGrouping: vi.fn(() => null) }));
vi.mock('./groups/GroupChoice', () => ({ NativeGroupIcon: 'GroupIcon' }));

vi.mock('react-native', () => ({ Pressable: 'Pressable', SectionList: 'SectionList', Text: 'Text',
  View: 'View', TextInput: 'TextInput', ActivityIndicator: 'Spinner', Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('./useThreadListScroll', () => ({ useThreadListScroll: () => ({}) }));
vi.mock('../../../../shared/remote-chat/client/useThreadGroups', () => ({ useThreadGroups: () => ({ groups: [] }) }));
beforeEach(() => { vi.stubGlobal('React', React); vi.mocked(useGrouping).mockReturnValue(null); });
afterEach(() => vi.unstubAllGlobals());

const thread: Thread = { id: 'chat', name: '对话名称', preview: '', cwd: '', updatedAt: 1 };
function model(patch: Partial<ThreadActionsModel> = {}): ThreadActionsModel {
  return { target: { thread, title: '对话名称', archived: false }, view: 'menu', name: '对话名称', busy: false, error: '',
    reason: () => '', open: vi.fn(), close: vi.fn(), submit: vi.fn(), changeView: vi.fn(), setName: vi.fn(), ...patch };
}
interface NodeProps { children?: ReactNode; label?: string; onPress?: () => void; disabled?: boolean }
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap(child => {
    if (!isValidElement<NodeProps>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}

it('opens native long-press actions without selecting a conversation and exposes the accessibility action', () => {
  const select = vi.fn(); const openActions = vi.fn();
  const list = ChatThreadList({ state: { ...initialChatState(), ready: true }, controller: {} as ChatController,
    newChat: vi.fn(), select, openActions, openProjectActions: vi.fn(), bottomInset: 0 });
  const row = list.props.renderItem({ item: thread, section: { depth: 0 } });
  row.props.onLongPress();
  expect(openActions).toHaveBeenCalledWith(thread);
  expect(select).not.toHaveBeenCalled();
  row.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
  expect(openActions).toHaveBeenCalledTimes(2);
  row.props.onPress(); expect(select).toHaveBeenCalledWith(thread);
});

it('keeps native actions compact, shows restore for archives and requires a second step before deletion', () => {
  const actions = model({ target: { thread, title: '侧栏显示的对话标题', archived: true }, name: '尚未保存的新名称' });
  const sheet = ChatThreadActions({ actions })!;
  expect(sheet.props.maxWidth).toBe(400);
  expect(sheet.props.title).toBe('操作 - 侧栏显示的对话标题');
  expect(sheet.props.truncateTitle).toBe(true);
  const options = nodes(sheet);
  expect(options.find(node => node.props.label === '恢复')).toBeDefined();
  options.find(node => node.props.label === '删除')?.props.onPress?.();
  expect(actions.changeView).toHaveBeenCalledWith('delete');
  expect(actions.submit).not.toHaveBeenCalled();
  const confirm = ChatThreadActions({ actions: { ...actions, view: 'delete' } })!;
  expect(nodes(confirm).some(node => typeof node.props.children === 'string'
    && node.props.children.includes('这条对话及其所有子对话将一起移入回收站'))).toBe(true);
  confirm.props.actions[1].onPress();
  expect(actions.submit).toHaveBeenCalledWith('delete');
});

it('disables empty names and busy confirmations while retaining errors for retry', () => {
  const empty = ChatThreadActions({ actions: model({ view: 'rename', name: '   ' }) })!;
  expect(empty.props.actions[1].disabled).toBe(true);
  const actions = model({ view: 'delete', busy: true, error: '删除未完成，请稍后重试。' });
  const busy = ChatThreadActions({ actions })!;
  expect(busy.props.dismissible).toBe(false);
  expect(busy.props.actions[1].loading).toBe(true);
  expect(busy.props.actions[0].disabled).toBe(true);
  expect(nodes(busy).some(node => node.props.children === actions.error)).toBe(true);
});

it('opens the same group picker for a conversation', () => {
  const setMoveTarget = vi.fn();
  vi.mocked(useGrouping).mockReturnValue({ ready: true, setMoveTarget } as unknown as ReturnType<typeof useGrouping>);
  const actions = model();
  nodes(ChatThreadActions({ actions })).find(node => node.props.label === '移动到分组')?.props.onPress?.();
  expect(setMoveTarget).toHaveBeenCalledWith({ kind: 'thread', id: thread.id });
  expect(actions.close).toHaveBeenCalledOnce();
});

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
