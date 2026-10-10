import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DisplaySettings } from './DisplaySettings';
import { DEFAULT_SETTINGS, type DesktopDisplay } from '../../../../../shared/remote-desktop/protocol';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, vi.fn()] ,
  useEffect: vi.fn(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text',
  ScrollView: 'ScrollView', TextInput: 'TextInput', StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'Icon' }));
interface Props {
  children?: ReactNode; accessibilityRole?: string; accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean }; onPress?: () => void; disabled?: boolean;
}
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => {
    if (!isValidElement<Props>(child)) return [];
    if (typeof child.type === 'function') {
      const render = child.type as (props: Props) => ReactNode;
      return nodes(render(child.props));
    }
    return [child, ...nodes(child.props.children)];
  });
}
const displays: DesktopDisplay[] = [
  { id: 'first', name: 'DISPLAY1', primary: true, width: 1920, height: 1080 },
  { id: 'second', name: 'DISPLAY2', primary: false, width: 1080, height: 1920 },
];
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('selects supported resolutions and disables changes while saving=%s', saving => {
  vi.stubGlobal('React', React);
  const change = vi.fn(async () => {});
  const size = { width: 2560, height: 1440 };
  const tree = nodes(DisplaySettings({ settings: { ...DEFAULT_SETTINGS, displayId: 'first' }, displays,
    update: vi.fn(), saving, close: vi.fn(), stats: { visible: true, toggle: vi.fn() },
    resolution: { options: [{ width: 1920, height: 1080 }, size], change } }));
  const current = tree.find(node => node.props.accessibilityLabel === '1920 × 1080')!;
  const option = tree.find(node => node.props.accessibilityLabel === '2560 × 1440')!;
  expect(current.props.accessibilityState?.checked).toBe(true);
  expect(option.props.accessibilityState).toEqual({ checked: false, disabled: saving });
  expect(option.props.disabled).toBe(saving);
  if (!saving) { option.props.onPress!(); expect(change).toHaveBeenCalledWith(size); }
});

it.each([false, true])('shows selected display, wraps labels and prevents repeat switches while saving=%s', saving => {
  vi.stubGlobal('React', React);
  const update = vi.fn(async () => {});
  const tree = nodes(DisplaySettings({ settings: { ...DEFAULT_SETTINGS, displayId: 'first' }, displays,
    update, saving, close: vi.fn(), stats: { visible: true, toggle: vi.fn() } }));
  const first = tree.find(node => node.props.accessibilityLabel === '显示器 1 · 主屏 · 1920 × 1080')!;
  const second = tree.find(node => node.props.accessibilityLabel === '显示器 2 · 1080 × 1920')!;
  expect(first.props.accessibilityState).toEqual({ checked: true, disabled: saving });
  expect(second.props.accessibilityState).toEqual({ checked: false, disabled: saving });
  expect(second.props.disabled).toBe(saving);
  if (!saving) {
    second.props.onPress!();
    expect(update).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, displayId: 'second' });
  }
});

it.each([false, true])('keeps the hide-stats switch consistent with visible=%s', visible => {
  vi.stubGlobal('React', React);
  const toggle = vi.fn();
  const tree = nodes(DisplaySettings({ settings: DEFAULT_SETTINGS, displays, update: vi.fn(),
    saving: false, close: vi.fn(), stats: { visible, toggle } }));
  const control = tree.find(node => node.props.accessibilityRole === 'switch')!;
  expect(control.props.accessibilityLabel).toBe('隐藏连接状态');
  expect(control.props.accessibilityState?.checked).toBe(!visible);
  control.props.onPress!();
  expect(toggle).toHaveBeenCalledOnce();
});

it('keeps close outside the scrollable settings and available while saving', () => {
  vi.stubGlobal('React', React);
  const close = vi.fn();
  const tree = nodes(DisplaySettings({ settings: DEFAULT_SETTINGS, displays, update: vi.fn(),
    saving: true, close, stats: { visible: true, toggle: vi.fn() } }));
  const scroller = tree.find(node => node.props.accessibilityLabel === '显示设置选项')!;
  expect(nodes(scroller.props.children).some(node => node.props.accessibilityLabel === '关闭显示设置')).toBe(false);
  const button = tree.find(node => node.props.accessibilityLabel === '关闭显示设置')!;
  expect(button.props.disabled).not.toBe(true);
  button.props.onPress!();
  expect(close).toHaveBeenCalledOnce();
});
