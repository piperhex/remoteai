import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatWorkDrawer } from './ChatWorkDrawer';
import type { Item, Turn } from './types';

const state = vi.hoisted(() => ({ expanded: new Set<string>() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => [state.expanded, (update: (value: Set<string>) => Set<string>) => {
    state.expanded = update(state.expanded);
  }],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ View: 'View', StyleSheet: { create: <T,>(styles: T) => styles } }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'Sheet' }));
vi.mock('../components/SheetScrollView', () => ({ SheetFlatList: 'List' }));
vi.mock('./ChatMessage', () => ({ ChatActivityRow: 'Row', ChatMessage: 'Message' }));
vi.mock('./ChatToolContent', () => ({ ChatToolContent: 'Details' }));
vi.mock('./ChatQuotes', async () => ({ QuoteSourceContext: (await import('react')).createContext(null) }));

function find<Props>(node: ReactNode, type: string): ReactElement<Props>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return child.type === type ? [child as ReactElement<Props>] : find<Props>(child.props.children, type);
  });
}

const first: Item = { id: 'first', type: 'commandExecution', command: 'npm test', status: 'inProgress' };
const second: Item = { id: 'second', type: 'commandExecution', command: 'git status', status: 'completed' };
interface RowProps { expanded: boolean; onOpen: (id: string) => void }
interface ListProps { renderItem: (info: { item: Item }) => ReactElement }
function render(items = [first, second]) {
  const turn: Turn = { id: 'turn', status: 'inProgress', items };
  const tree = ChatWorkDrawer({ entry: { turn, items }, onClose: vi.fn() });
  const list = find<ListProps>(tree, 'List')[0].props;
  return { tree, rows: items.map(item => list.renderItem({ item })) };
}

beforeEach(() => { state.expanded = new Set(); vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

it('mounts details only for expanded rows, receives live output and unmounts on collapse', () => {
  let view = render();
  expect(view.tree.props.fullscreen).toBe(true);
  expect(find(view.rows, 'Details')).toHaveLength(0);
  expect(find<RowProps>(view.rows, 'Row').every(row => !row.props.expanded)).toBe(true);
  find<RowProps>(view.rows[0], 'Row')[0].props.onOpen(first.id);
  view = render([{ ...first, aggregatedOutput: 'NEW OUTPUT', status: 'completed' }, second]);
  const details = find<{ item: Item }>(view.rows, 'Details');
  expect(details).toHaveLength(1);
  expect(details[0].props.item.aggregatedOutput).toBe('NEW OUTPUT');
  expect(find(view.rows[1], 'Details')).toHaveLength(0);
  find<RowProps>(view.rows[0], 'Row')[0].props.onOpen(first.id);
  expect(find(render().rows, 'Details')).toHaveLength(0);
});
