import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTurnSummary } from './ChatTurnSummary';
import type { Turn } from './types';

const reviewContext = vi.hoisted(() => ({ value: {} as object | null }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useMemo: <T,>(compute: () => T) => compute(),
  useContext: () => reviewContext.value,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('./ChatImage', () => ({ ChatImage: 'Image' }));

interface Props { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; disabled?: boolean }
function descendants(node: ReactNode): { type: unknown; props: Props }[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Props>(child)) return [];
    if (typeof child.type === 'function') {
      return descendants((child.type as (props: Props) => ReactNode)(child.props));
    }
    return [child, ...descendants(child.props.children)];
  });
}
function content(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<Props>(child)) return String(child);
    if (typeof child.type === 'function') return content((child.type as (props: Props) => ReactNode)(child.props));
    return content(child.props.children);
  }).join('');
}
beforeEach(() => { vi.stubGlobal('React', React); reviewContext.value = {}; });
afterEach(() => vi.unstubAllGlobals());

const turn: Turn = { id: 'turn', status: 'inProgress', items: [
  { id: 'edit', type: 'fileChange', status: 'completed', changes: [
    { path: 'src/example.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-before\n+after\n' },
  ] },
  { id: 'command', type: 'commandExecution', status: 'inProgress', command: 'npm test' },
] };

it('keeps running file edits compact and opens the turn changes when pressed', () => {
  const onOpen = vi.fn();
  const tree = ChatTurnSummary({ turn, onOpen });
  expect(content(tree)).toContain('已编辑 1 个文件+1−1');
  expect(content(tree)).not.toContain('审核');
  expect(content(tree)).not.toContain('验收结果');
  expect(content(tree)).not.toContain('src/example.ts');
  descendants(tree).find(node => node.props.accessibilityLabel === '查看本轮修改：1 个文件')?.props.onPress?.();
  expect(onOpen).toHaveBeenCalledWith('turn', 'changes');
});

it.each(['completed', 'interrupted', 'failed'])('shows review actions in the file header when the turn is %s', status => {
  const onOpen = vi.fn();
  const tree = ChatTurnSummary({ turn: { ...turn, status }, onOpen });
  expect(content(tree)).toContain('验收结果审核');
  expect(content(tree)).not.toContain('任务验收');
  expect(content(tree)).toContain('src/example.ts');
  const elements = descendants(tree);
  elements.find(node => node.props.accessibilityLabel === '查看本轮修改：1 个文件')?.props.onPress?.();
  expect(onOpen).toHaveBeenLastCalledWith('turn', 'changes');
  elements.find(node => node.props.accessibilityLabel === '审核')?.props.onPress?.();
  expect(onOpen).toHaveBeenLastCalledWith('turn', 'changes');
  const result = elements.find(node => node.props.accessibilityLabel === '验收结果');
  const header = elements.find(node => node.type === 'View' && content(node.props.children) === '验收结果审核');
  expect(descendants(header?.props.children).filter(node => node.type === 'Pressable')
    .map(node => node.props.accessibilityLabel)).toEqual(['验收结果', '审核']);
  result?.props.onPress?.();
  expect(onOpen).toHaveBeenLastCalledWith('turn', 'result');
});

it('hides acceptance when review is unavailable or the turn has no file changes', () => {
  const noChanges = ChatTurnSummary({ turn: { ...turn, status: 'completed', items: [] }, onOpen: vi.fn() });
  expect(content(noChanges)).not.toContain('验收结果');
  reviewContext.value = null;
  const unavailable = ChatTurnSummary({ turn: { ...turn, status: 'completed' }, onOpen: vi.fn() });
  expect(content(unavailable)).not.toContain('验收结果');
  expect(content(unavailable)).toContain('审核');
});

it('shows retry after the error notice and continues when pressed', () => {
  const retry = vi.fn();
  reviewContext.value = { turnId: 'turn', disabled: false, pending: false, retry };
  const tree = ChatTurnSummary({ turn: { ...turn, status: 'failed' }, onOpen: vi.fn() });
  expect(content(tree)).toContain('本次回复遇到问题，已中断。 查看报错详情重试');
  const button = descendants(tree).find(node => node.type === 'Pressable' && content(node.props.children) === '重试');
  expect(button?.props.disabled).toBe(false);
  button?.props.onPress?.();
  expect(retry).toHaveBeenCalledOnce();
});

it('disables retry while pending and omits it from older errors', () => {
  reviewContext.value = { turnId: 'turn', disabled: true, pending: true, retry: vi.fn() };
  const failed = { ...turn, status: 'failed' };
  const tree = ChatTurnSummary({ turn: failed, onOpen: vi.fn() });
  const button = descendants(tree).find(node => node.type === 'Pressable' && content(node.props.children) === '正在重试…');
  expect(button?.props.disabled).toBe(true);
  expect(content(ChatTurnSummary({ turn: { ...failed, id: 'old' }, onOpen: vi.fn() }))).not.toContain('正在重试…');
});
