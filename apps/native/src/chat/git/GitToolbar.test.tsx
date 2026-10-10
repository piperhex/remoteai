import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GitToolbar } from './GitToolbar';
import type { RemoteGit } from '../../../../../shared/remote-chat/useRemoteGit';

const state = vi.hoisted(() => ({ menu: 'actions' as string | null, action: 'update' }));
vi.mock('react', async original => ({ ...await original<typeof React>(),
  useState: (initial: unknown) => {
    if (initial === null) return [state.menu, (value: string | null) => { state.menu = value; }];
    if (initial === 'update') return [state.action, (value: string) => { state.action = value; }];
    return [initial, vi.fn()];
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View',
  ScrollView: 'ScrollView', TextInput: 'Input', Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));

interface NodeProps {
  children?: ReactNode; disabled?: boolean; onPress?: () => void; style?: { maxWidth?: number };
}
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<NodeProps>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
function text(tree: ReactNode): string {
  return Children.toArray(tree).map(child => isValidElement<NodeProps>(child)
    ? text(child.props.children) : String(child)).join('');
}
const action = vi.fn();
const panel = { busy: false, changes: { branch: 'master', files: [] }, strategy: 'rebase',
  repository: { upstream: 'origin/master', remotes: ['origin'], branches: [], ahead: 1, behind: 2 },
  action } as unknown as RemoteGit;

beforeEach(() => {
  state.menu = 'actions'; state.action = 'update'; vi.clearAllMocks(); vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

it('offers automatic merge for update and leaves strategy choices on pull', () => {
  const tree = GitToolbar({ panel, connected: true });
  expect(text(tree)).toContain('获取远程更新，无冲突时自动合并并提交。');
  expect(text(tree)).not.toContain('变基 Rebase');
  const submit = nodes(tree).find(node => node.props.onPress && text(node) === '执行 更新项目')!;
  expect(submit.props.disabled).toBe(false);
  submit.props.onPress!();
  expect(action).toHaveBeenCalledExactlyOnceWith('update');
  state.menu = 'actions'; state.action = 'pull';
  expect(text(GitToolbar({ panel, connected: true }))).toContain('变基 Rebase');
});

it('keeps the explanation compact and disables update for local edits', () => {
  const dirty = { ...panel, changes: { ...panel.changes!, files: [{ path: 'local.txt' }] } } as RemoteGit;
  const tree = GitToolbar({ panel: dirty, connected: true });
  const hint = nodes(tree).find(node => node.props.children === '获取远程更新，无冲突时自动合并并提交。')!;
  expect(hint.props.style?.maxWidth).toBe(400);
  expect(text(tree)).toContain('请先提交本地改动，再拉取或更新项目。');
  const submit = nodes(tree).find(node => node.props.onPress && text(node) === '执行 更新项目')!;
  expect(submit.props.disabled).toBe(true);
});
