import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopStats } from './DesktopStats';
import type { DesktopStats as Stats } from '../../../../../shared/remote-desktop/protocol';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ View: 'View', Pressable: 'Pressable', Text: 'Text', Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(styles: T) => styles } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));

interface Props { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void }
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
afterEach(() => vi.unstubAllGlobals());

it('keeps the native stats panel usable when reconnecting with a null route latency', () => {
  vi.stubGlobal('React', React);
  const close = vi.fn();
  const stats: Stats = JSON.parse('{"fps":0,"bitrate":0,"width":1920,"height":1080,"rttMs":null}');
  Object.assign(stats, { captureMethod: 'DXGI', videoCodec: 'h264', hardwareEncoding: true, hardwareDecoding: true });
  const render = () => nodes(DesktopStats({ stats, close }));
  const elements = render();
  const text = elements.find(node => node.props.accessibilityLabel === '连接状态')!.props.children;
  expect(text).toContain('— ms 延迟');
  expect(text).toContain('1920 × 1080');
  expect(text).toMatch(/DXGI · H264$/);
  stats.rttMs = 24;
  expect(render().find(node => node.props.accessibilityLabel === '连接状态')!.props.children).toContain('24 ms 延迟');
  elements.find(node => node.props.accessibilityLabel === '关闭连接状态')!.props.onPress!();
  expect(close).toHaveBeenCalledOnce();
});
