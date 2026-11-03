import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatProfileMenu } from './ChatProfileMenu';
import { ChatGuiUpdateSheet } from './ChatGuiUpdateSheet';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { parseGuiAccountsSnapshot, type GuiAccountsClient, type GuiAccountsSnapshot }
  from '../../../../shared/remote-chat/guiAccounts';

const state = vi.hoisted(() => ({ panel: 'profile' as string | null, snapshot: null as GuiAccountsSnapshot | null }));
vi.mock('react', async original => ({ ...await original<typeof React>(), useEffect: vi.fn(),
  useState: (initial: unknown) => initial === null
    ? [state.panel, (value: string | null) => { state.panel = value; }] : ['', vi.fn()] ,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', TextInput: 'Input', View: 'View',
  ActivityIndicator: 'Spinner', Platform: { OS: 'android' }, StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../../../../shared/remote-chat/client/useGuiAccounts', () => ({ useGuiAccounts: () => ({
  loading: false, saving: false, snapshot: state.snapshot, error: '', refresh: vi.fn(), select: vi.fn(),
}) }));
interface NodeProps {
  children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; client?: GuiToolsClient;
  connected?: boolean; running?: boolean; onBack?: () => void;
}
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<NodeProps>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
const props = { client: {} as GuiAccountsClient, guiTools: {} as GuiToolsClient, email: 'test@example.test',
  active: true, ready: false, running: true, chooseDevice: vi.fn() };
beforeEach(() => { state.panel = 'profile'; state.snapshot = null; vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

it('opens GUI updates from the avatar and forwards this computer connection and task state', () => {
  const entry = nodes(ChatProfileMenu(props)).find(node => node.props.accessibilityLabel === '更新 Codex GUI');
  expect(entry).toBeDefined(); entry?.props.onPress?.();
  const sheet = nodes(ChatProfileMenu(props)).find(node => node.type === ChatGuiUpdateSheet);
  expect(sheet?.props.client).toBe(props.guiTools); expect(sheet?.props.connected).toBe(false);
  expect(sheet?.props.running).toBe(true);
  const inactive = nodes(ChatProfileMenu({ ...props, active: false }));
  expect(inactive.some(node => node.type === ChatGuiUpdateSheet)).toBe(false);
  sheet?.props.onBack?.(); expect(state.panel).toBe('profile');
});

it('keeps the drawer avatar and account panel usable after the background service takes over', () => {
  state.snapshot = parseGuiAccountsSnapshot({ accounts: [], providers: [], selection: null });
  const profile = nodes(ChatProfileMenu({ ...props, ready: true }));
  expect(profile.some(node => node.props.accessibilityLabel === '打开头像菜单')).toBe(true);
  profile.find(node => node.props.accessibilityLabel === '切换账户')?.props.onPress?.();
  const picker = nodes(ChatProfileMenu({ ...props, ready: true }));
  expect(picker.some(node => node.props.children === '电脑上的聊天暂不可用，请在电脑上重新打开 Remote AI。')).toBe(true);
  expect(picker.some(node => node.props.children === '请先在电脑上开启本地代理，再切换账户。')).toBe(false);
  expect(picker.some(node => node.props.children === '暂无可选账户，请先在电脑上添加账户。')).toBe(false);
});
