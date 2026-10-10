import React, { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatTaskStatus } from './ChatTaskStatus';
import { ChatConnectionHealth } from './ChatConnectionHealth';
import { initialChatState, type ChatState } from './types';

vi.mock('../i18n', () => ({ t: (value: string) => value, useLanguage() {} }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View', Text: 'Text',
  StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('../components/BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
vi.mock('../components/SheetScrollView', () => ({ SheetScrollView: 'SheetScrollView' }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

function text(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return String(child);
    if (typeof child.type === 'function') {
      const component = child.type as (props: { children?: ReactNode }) => ReactNode;
      return text(component(child.props));
    }
    return text(child.props.children);
  }).join(' ');
}

it('renders the native connection check within the compact sheet width', () => {
  const view = ChatConnectionHealth({ state: { ...initialChatState(), mode: 'relay', ready: true },
    device: { online: true }, reconnect: vi.fn(), close: vi.fn() });
  expect(view.props.maxWidth).toBe(400);
  const content = text(view);
  expect(content).toContain('已通过中转连接');
  expect(content).toContain('聊天可正常使用');
  expect(content).toContain('电脑聊天');
  expect(content).toContain('连接正常，可以发送任务');
  expect(content).toContain('中转不会阻止 AI 执行。');
  expect(content).toContain('本机公网 IP 和端口');
  expect(content).toContain('电脑公网 IP 和端口');
  expect(content.match(/尚未识别/g)).toHaveLength(2);
});

it('renders detected endpoints on native with complete IPv6 addresses and ports', () => {
  const view = ChatConnectionHealth({ state: { ...initialChatState(), publicEndpoints: {
    local: [{ host: '203.0.113.8', port: 42123, protocol: 'udp' }],
    remote: [{ host: '2001:db8:1234:5678:abcd:ef01:2345:6789', port: 65535, protocol: 'tcp' }],
  } }, device: { online: true }, reconnect: vi.fn(), close: vi.fn() });
  const content = text(view);
  expect(content).toContain('203.0.113.8:42123 · UDP');
  expect(content).toContain('[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535 · TCP');
  expect(content).not.toContain('尚未识别');
});

it('shows the active P2P pair separately and hides it immediately on relay or reconnect', () => {
  const state: ChatState = { ...initialChatState(), mode: 'direct', ready: true, directEndpoints: {
    local: { host: '192.168.1.4', port: 45678, protocol: 'tcp' },
    remote: { host: '2001:db8:1234:5678:abcd:ef01:2345:6789', port: 65535, protocol: 'tcp' },
  } };
  const render = () => text(ChatConnectionHealth({ state,
    device: { online: true }, reconnect: vi.fn(), close: vi.fn() }));
  expect(render()).toContain('当前 P2P 连接');
  expect(render()).toContain('192.168.1.4:45678 · TCP');
  expect(render()).toContain('[2001:db8:1234:5678:abcd:ef01:2345:6789]:65535 · TCP');
  for (const mode of ['relay', 'connecting', 'offline'] as const) {
    state.mode = mode;
    expect(render()).not.toContain('当前 P2P 连接');
    expect(render()).not.toContain('192.168.1.4');
  }
  state.mode = 'direct'; state.directEndpoints = undefined;
  expect(render().match(/暂无法获取/g)).toHaveLength(2);
});

it('keeps routine progress hidden and renders uncertain delivery and failures', () => {
  const state: ChatState = { ...initialChatState(), ready: true, mode: 'relay',
    selected: { id: 'thread', cwd: '', preview: '', updatedAt: 0,
      turns: [{ id: 'old', status: 'completed', items: [] }] } };
  const turn = state.selected!.turns![0];
  for (const status of ['inProgress', 'completed', 'interrupted']) {
    turn.status = status;
    expect(ChatTaskStatus({ state })).toBeNull();
  }
  turn.status = 'completed';
  state.notificationError = true;
  expect(text(ChatTaskStatus({ state }))).toContain('部分提醒未能保存');
  expect(text(ChatTaskStatus({ state }))).not.toContain('结果待确认');
  state.deliveries = { thread: { requestId: 'send', threadId: 'thread', phase: 'unknown' } };
  const content = text(ChatTaskStatus({ state }));
  expect(content).toContain('发送结果待核实');
  expect(content).toContain('避免重复发送');
  expect(content).toContain('部分提醒未能保存');
  expect(content).not.toContain('结果待确认');
  state.deliveries = {};
  state.notificationError = false;
  turn.status = 'failed';
  expect(text(ChatTaskStatus({ state }))).toContain('任务未完成');
});

it('prefers the confirmed public mapping over the phone VPN address in the current P2P connection', () => {
  const view = ChatConnectionHealth({ state: { ...initialChatState(), mode: 'direct', ready: true,
    directEndpoints: {
      local: { host: '172.19.0.1', port: 47894, protocol: 'udp' },
      localPublic: { host: '203.0.113.8', port: 42123, protocol: 'udp' },
      remote: { host: '198.51.100.8', port: 46184, protocol: 'udp' },
    } }, device: { online: true }, reconnect: vi.fn(), close: vi.fn() });
  const content = text(view);
  expect(content).toContain('本机公网 IP 和端口');
  expect(content).toContain('203.0.113.8:42123 · UDP');
  expect(content).not.toContain('172.19.0.1');
  expect(content).toContain('198.51.100.8:46184 · UDP');
});
