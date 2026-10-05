import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Modal, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RTCView } from 'react-native-webrtc';
import { RemoteDesktop } from './RemoteDesktop';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';

const runtime = vi.hoisted(() => ({ landscape: false, viewOnly: false, input: vi.fn(), rotate: vi.fn(),
  orientation: vi.fn(), onShow: vi.fn(),
  session: vi.fn(), dimensions: vi.fn(), createPeer: vi.fn(), immersive: vi.fn(), mute: vi.fn(),
  stream: { toURL: vi.fn(() => 'native-ios-stream') } }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => [value, runtime.dimensions], useRef: () => ({ current: null }),
  useEffect: vi.fn(), useCallback: (callback: unknown) => callback ,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Modal: 'Modal', View: 'View', Pressable: 'Pressable', Text: 'Text',
  ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' },
  NativeModules: { DesktopWindow: { setImmersive: runtime.immersive } }, findNodeHandle: vi.fn(),
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} } }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider',
}));
vi.mock('react-native-webrtc', () => ({ RTCView: 'RTCView', RTCPeerConnection: class {
  constructor(configuration: unknown) { runtime.createPeer(configuration); }
} }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('../terminal/useTerminalOrientation', () => ({ useTerminalOrientation: (...options: unknown[]) => {
  runtime.orientation(...options);
  return { landscape: runtime.landscape, rotate: runtime.rotate, onShow: runtime.onShow };
} }));
vi.mock('../../../../../shared/remote-desktop/useDesktopSession', () => ({ useDesktopSession: (options: unknown) => {
  runtime.session(options);
  return { stream: runtime.stream, pointer: {}, input: runtime.input, hasAudio: true, muted: false, mute: runtime.mute,
    capabilities: { control: !runtime.viewOnly, keyboard: !runtime.viewOnly } };
} }));
vi.mock('../../../../../shared/remote-desktop/useMousePanel', () => ({ useMousePanel: () => ({ expanded: true }) }));
vi.mock('../../../../../shared/remote-desktop/useMouseViewport', () => ({
  useMouseViewport: (_pointer: unknown, viewport: unknown) => ({ viewport }),
}));
vi.mock('../../../../../shared/remote-desktop/useDesktopZoom', () => ({
  useDesktopZoom: (viewport: unknown) => ({ viewport }),
}));
vi.mock('./useTrackpad', () => ({ useTrackpad: () => ({ panHandlers: {} }) }));
vi.mock('./MousePad', () => ({ DesktopMouse: 'DesktopMouse' }));
vi.mock('./DesktopStats', () => ({ DesktopStats: 'DesktopStats' }));
vi.mock('./DisplaySettings', () => ({ DisplaySettings: 'DisplaySettings' }));
vi.mock('./DesktopKeyboard', () => ({ DesktopKeyboard: 'DesktopKeyboard' }));

interface Props {
  disabled?: boolean;
  children?: ReactNode; edges?: string[]; streamURL?: string;
  presentationStyle?: string; supportedOrientations?: string[];
  visible?: boolean; onRequestClose?: () => void; onShow?: () => void; accessibilityLabel?: string; onPress?: () => void;
  onDimensionsChange?: (event: { nativeEvent: { width: number; height: number } }) => void;
}
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
const client: DesktopClient = { open: vi.fn(), signal: vi.fn(), settings: vi.fn(), close: vi.fn() };
const render = (active = true, close = vi.fn()) => nodes(RemoteDesktop({ client, active, close }));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); runtime.landscape = false; runtime.viewOnly = false; Platform.OS = 'ios';
});
afterEach(() => vi.unstubAllGlobals());

it.each(['ios', 'android'] as const)('coordinates automatic landscape with modal presentation on %s', platform => {
  Platform.OS = platform;
  const elements = render();
  expect(runtime.orientation).toHaveBeenCalledWith(true, { initialLandscape: true, waitForShow: platform === 'ios' });
  expect(runtime.onShow).not.toHaveBeenCalled();
  elements.find(node => node.type === Modal)!.props.onShow!();
  expect(runtime.onShow).toHaveBeenCalledOnce();
});

it('keeps display controls available but disables remote input in view-only mode', () => {
  runtime.viewOnly = true;
  const elements = render();
  for (const label of ['键盘', '显示桌面', '所有窗口']) {
    expect(elements.find(node => node.props.accessibilityLabel === label)?.props.disabled).toBe(true);
  }
  expect(elements.find(node => node.props.accessibilityLabel === '显示')?.props.disabled).not.toBe(true);
});

it('uses native iOS video, forwards ICE configuration and keeps control actions available', () => {
  const elements = render();
  const video = elements.find(node => node.type === RTCView)!;
  expect(video.props.streamURL).toBe('native-ios-stream');
  const options = runtime.session.mock.calls[0][0] as { createPeer: (config: RTCConfiguration) => RTCPeerConnection };
  options.createPeer({ iceServers: [{ urls: 'turn:relay.example.com', username: 'user', credential: 'secret' }] });
  expect(runtime.createPeer).toHaveBeenCalledWith({
    iceServers: [{ urls: 'turn:relay.example.com', username: 'user', credential: 'secret' }],
  });
  options.createPeer({ iceServers: [{ urls: 'turn:relay.example.com' }], iceTransportPolicy: 'relay' });
  expect(runtime.createPeer).toHaveBeenLastCalledWith({
    iceServers: [{ urls: 'turn:relay.example.com' }], iceTransportPolicy: 'relay',
  });
  video.props.onDimensionsChange!({ nativeEvent: { width: 1920, height: 1080 } });
  expect(runtime.dimensions).toHaveBeenCalledWith({ width: 1920, height: 1080 });
  for (const label of ['显示桌面', '所有窗口', '旋转']) {
    elements.find(node => node.type === Pressable && node.props.accessibilityLabel === label)!.props.onPress!();
  }
  expect(runtime.input.mock.calls).toEqual([[{ kind: 'key', key: 'desktop' }], [{ kind: 'key', key: 'windows' }]]);
  expect(runtime.rotate).toHaveBeenCalledOnce();
  elements.find(node => node.type === Pressable && node.props.accessibilityLabel === '静音')!.props.onPress!();
  expect(runtime.mute).toHaveBeenCalledWith(true);
  expect(runtime.immersive).not.toHaveBeenCalled();
});

it.each([false, true])('fits the video and keeps the iPhone/iPad home indicator clear in landscape=%s', landscape => {
  runtime.landscape = landscape;
  const elements = render();
  expect(elements.find(node => node.type === SafeAreaView)!.props.edges)
    .toEqual(landscape ? ['left', 'right', 'bottom'] : ['left', 'right', 'top', 'bottom']);
  expect(elements.find(node => node.type === Modal)!.props).toMatchObject({ presentationStyle: 'fullScreen',
    supportedOrientations: ['portrait', 'landscape-left', 'landscape-right'], visible: true });
  expect(elements.find(node => node.type === RTCView)!.props).toMatchObject({ style: {
    width: 400, height: 225,
    transform: [{ translateX: 0 }, { translateY: 187.5 }, { scale: 1 }],
  } });
});

it('retains Android immersive edges and delegates close and foreground state to the session', () => {
  Platform.OS = 'android'; runtime.landscape = true;
  const close = vi.fn(); const elements = render(false, close);
  expect(elements.find(node => node.type === SafeAreaView)!.props.edges).toEqual(['left', 'right']);
  expect(runtime.session).toHaveBeenCalledWith(expect.objectContaining({ client, active: false }));
  elements.find(node => node.type === Modal)!.props.onRequestClose!();
  expect(close).toHaveBeenCalledOnce();
});
