import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMessages } from './ChatMessages';
import { conversationEntries } from './turnPresentation';
import type { TimelineEntry } from './activityTimeline';
import type { Item, Turn } from './types';
import { styles } from './styles';

const state = vi.hoisted(() => ({ selection: null as unknown, inline: new Map<string, boolean>(),
  scroll: vi.fn(), dismiss: vi.fn(), footerLayout: vi.fn() }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  memo: <T,>(component: T) => component,
  useMemo: <T,>(compute: () => T) => compute(),
  useCallback: <T,>(callback: T) => callback,
  useState: () => [state.selection, (value: unknown) => { state.selection = value; }],

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'Spinner', FlatList: 'FlatList', Pressable: 'Pressable',
  RefreshControl: 'RefreshControl', Text: 'Text', View: 'View', Keyboard: { dismiss: state.dismiss },
  StyleSheet: { create: <T,>(value: T) => value },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('./ChatMessage', () => ({ ChatActivityRow: 'ActivityRow', ChatMessage: 'Message' }));
vi.mock('./ChatWorkDrawer', () => ({ ChatWorkDrawer: 'WorkDrawer' }));
vi.mock('./ChatToolDetails', () => ({ ChatToolDetails: 'ToolDetails' }));
vi.mock('./ChatProcessSummary', () => ({ ChatProcessSummary: 'ProcessSummary' }));
vi.mock('./ChatTurnSummary', () => ({ ChatTurnDuration: 'Duration', ChatTurnSummary: 'Summary' }));
vi.mock('./ChatTurnDetails', () => ({ ChatTurnDetails: 'TurnDetails' }));
vi.mock('./useHistoryRefresh', () => ({ useHistoryRefresh: () => ({}) }));
vi.mock('./useConversationEntries', () => ({ useConversationEntries: (turns: Turn[]) => ({
  entries: conversationEntries(turns, state.inline), hasObservedLiveTurn: true,
  setInline: (id: string, inline: boolean) => { state.inline.set(id, inline); },
}) }));
vi.mock('./useChatScroll', () => ({ useChatScroll: (options: unknown) => {
  state.scroll(options);
  return { list: { current: null }, initializing: false, onItemLayout: vi.fn(), scrollEventThrottle: 16,
    onFooterLayout: state.footerLayout, historyBottomSpace: 120 };
} }));

interface ListProps {
  data: TimelineEntry[]; renderItem: (props: { item: TimelineEntry }) => ReactElement; scrollEventThrottle: number;
  ListFooterComponent: ReactElement<{ children?: ReactNode; onLayout: () => void; style: unknown }>;
  ListEmptyComponent: ReactNode; contentContainerStyle: unknown;
}
interface DrawerProps { entry: { items: Item[] }; onOpen: (id: string) => void; onClose: () => void }
interface DetailProps { item: Item; onBack: () => void }
interface ActivityProps { item: Item; count: number; running: boolean; onOpen: () => void }

beforeEach(() => {
  state.selection = null;
  state.inline.clear();
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

function findElement<Props>(node: ReactNode, type: string): ReactElement<Props> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child as ReactElement<Props>;
    const found = findElement<Props>(child.props.children, type);
    if (found) return found;
  }
  return undefined;
}

function element<Props>(node: ReactNode, type: string): ReactElement<Props> {
  const result = findElement<Props>(node, type);
  if (!result) throw new Error(`Missing ${type}`);
  return result;
}

const command = (id: string, status = 'completed'): Item => ({ id, type: 'commandExecution', status,
  command: `echo ${id}`, aggregatedOutput: `output-${id}` });
const render = (turn: Turn) => ChatMessages({ thread: { id: 'thread', cwd: '', preview: '', updatedAt: 0,
  turns: [turn] }, loading: false, loadingMore: false, hasMore: false });

it('passes the initial positioning event frequency through to the native list', () => {
  const tree = render({ id: 'turn', status: 'completed', items: [command('single')] });
  expect(element<ListProps>(tree, 'FlatList').props.scrollEventThrottle).toBe(16);
});

it('keeps progress in the scrolling footer and preserves the history spacer and layout measurement', () => {
  const processing = <span>正在生成回复 · 12秒 (共计42秒)</span>;
  const tree = ChatMessages({ thread: { id: 'thread', cwd: '', preview: '', updatedAt: 0,
    turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'reply', type: 'agentMessage', text: '回复' }] }] },
    processing });
  const list = element<ListProps>(tree, 'FlatList').props;
  expect(list.data.at(-1)).toMatchObject({ item: { id: 'reply' } });
  expect(list.ListFooterComponent.props.children).toBe(processing);
  expect(list.ListFooterComponent.props.style).toEqual([styles.messageFooter, { paddingBottom: 120 }]);
  list.ListFooterComponent.props.onLayout();
  expect(state.footerLayout).toHaveBeenCalledOnce();
  expect(findElement(tree, 'span')).toBeUndefined();
});

it('shows progress instead of the empty welcome and removes it when the reply completes', () => {
  const processing = <span>正在等待响应</span>;
  const waiting = element<ListProps>(ChatMessages({ thread: null, processing }), 'FlatList').props;
  expect(waiting.ListEmptyComponent).toBeNull();
  expect(waiting.contentContainerStyle).toBe(styles.messages);
  expect(waiting.ListFooterComponent.props.children).toBe(processing);
  const completed = element<ListProps>(render({ id: 'turn', status: 'completed',
    items: [{ id: 'reply', type: 'agentMessage', text: '回复完成' }] }), 'FlatList').props;
  expect(completed.ListFooterComponent.props.children).toBeUndefined();
});

function activityRow(tree: ReactNode): ActivityProps {
  const list = element<ListProps>(tree, 'FlatList').props;
  const group = list.data.find(entry => entry.kind === 'activities');
  if (!group) throw new Error('Missing activity group');
  const cell = list.renderItem({ item: group }) as ReactElement<{ children: ReactElement }>;
  const row = cell.props.children;
  // Exercise the real row callbacks; native layout and drawing remain outside this test.
  const component = row.type as (props: unknown) => ReactElement<ActivityProps>;
  return component(row.props).props;
}

it('opens all grouped commands, inspects one, and returns to live updates in the same drawer', () => {
  const live: Turn = { id: 'turn', status: 'inProgress', items: [command('first'), command('second', 'inProgress')] };
  let tree = render(live);
  expect(findElement(tree, 'WorkDrawer')).toBeUndefined();
  const row = activityRow(tree);
  expect(row.item.id).toBe('second');
  expect(row.count).toBe(2);
  row.onOpen();
  tree = render(live);
  const drawer = element<DrawerProps>(tree, 'WorkDrawer').props;
  expect(drawer.entry.items.map(item => item.id)).toEqual(['first', 'second']);
  drawer.onOpen('first');
  tree = render(live);
  const detail = element<DetailProps>(tree, 'ToolDetails').props;
  expect(detail.item.aggregatedOutput).toBe('output-first');
  expect(findElement(tree, 'WorkDrawer')).toBeUndefined();
  const updated = { ...live, items: [command('first'), command('second'), command('third', 'inProgress')] };
  expect(element<DetailProps>(render(updated), 'ToolDetails').props.item.id).toBe('first');
  detail.onBack();
  tree = render(updated);
  expect(element<DrawerProps>(tree, 'WorkDrawer').props.entry.items).toHaveLength(3);
  expect(activityRow(tree).item.id).toBe('third');
  expect(state.scroll).toHaveBeenLastCalledWith(expect.objectContaining({ latestItemId: 'turn:activities:first' }));
  const completed = render({ ...updated, status: 'completed', items: updated.items.map(item => ({
    ...item, status: 'completed',
  })) });
  expect(element<DrawerProps>(completed, 'WorkDrawer').props.entry.items.every(item => item.status === 'completed'))
    .toBe(true);
  expect(activityRow(completed).running).toBe(false);
  element<DrawerProps>(completed, 'WorkDrawer').props.onClose();
  expect(findElement(render(updated), 'WorkDrawer')).toBeUndefined();
});

it('continues opening a single command directly without a group drawer', () => {
  const tree = render({ id: 'turn', status: 'inProgress', items: [command('single', 'inProgress')] });
  const list = element<ListProps>(tree, 'FlatList').props;
  expect(list.data.some(entry => entry.kind === 'activities')).toBe(false);
  const message = list.data.find(entry => entry.kind === 'process');
  if (!message) throw new Error('Missing single command');
  const cell = list.renderItem({ item: message }) as ReactElement<{ children: ReactElement }>;
  const component = cell.props.children.type as (props: unknown) => ReactElement<{ onOpen: (id: string) => void }>;
  component(cell.props.children.props).props.onOpen('single');
  const opened = render({ id: 'turn', status: 'inProgress', items: [command('single', 'inProgress')] });
  expect(element<DetailProps>(opened, 'ToolDetails').props.item.id).toBe('single');
  expect(findElement(opened, 'WorkDrawer')).toBeUndefined();
});
