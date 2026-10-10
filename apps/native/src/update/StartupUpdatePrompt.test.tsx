import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StartupUpdatePrompt } from './StartupUpdatePrompt';
import type { AppRelease } from './appUpdate';

const state = vi.hoisted(() => ({ release: null as AppRelease | null,
  ignore: vi.fn(), dismiss: vi.fn(), download: vi.fn(), error: '' }));
vi.mock('react', async (original) => ({ ...await original<typeof React>(),
  useState: () => [state.error, (error: string) => { state.error = error; }] ,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../../../../shared/app-update/useStartupUpdate', () => ({
  useStartupUpdate: () => ({ release: state.release, ignoreVersion: state.ignore, dismiss: state.dismiss }),
}));
vi.mock('./startupUpdate', () => ({ startupUpdateOptions: {} }));
vi.mock('./updateActions', () => ({ beginAppUpdateDownload: state.download }));
vi.mock('./useAndroidUpdateDownloadState', () => ({ useAndroidUpdateDownloadState: () => ({ status: 'idle' }) }));
vi.mock('react-native', () => ({ Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(value: T) => value } }));

interface NodeProps { children?: ReactNode; onPress?: () => void; style?: { maxWidth?: number } }
function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap((child) => isValidElement<NodeProps>(child)
    ? [child, ...nodes(child.props.children)] : []);
}
function text(tree: ReactNode): string {
  return Children.toArray(tree).map((child) => isValidElement<NodeProps>(child)
    ? text(child.props.children) : String(child)).join('');
}
function press(label: string) {
  const button = nodes(StartupUpdatePrompt()).find((node) => node.props.onPress && text(node) === label);
  expect(button).toBeDefined();
  button?.props.onPress?.();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
  state.error = '';
  state.release = { version: '1.6.0' } as AppRelease;
  state.ignore.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it('shows a compact version prompt with exactly the two requested choices', () => {
  const prompt = StartupUpdatePrompt();
  expect(text(prompt)).toContain('Remote AI v1.6.0 已发布');
  expect(nodes(prompt).filter((node) => node.props.onPress).map(text)).toEqual(['忽略本版本', '立即更新']);
  expect(nodes(prompt).some((node) => node.props.style?.maxWidth === 400)).toBe(true);
  expect(state.download).not.toHaveBeenCalled();
});

it('ignores a version without starting a download', () => {
  press('忽略本版本');
  expect(state.ignore).toHaveBeenCalledOnce();
  expect(state.download).not.toHaveBeenCalled();
});

it('starts the existing update flow when update now is pressed', () => {
  press('立即更新');
  expect(state.dismiss).toHaveBeenCalledOnce();
  expect(state.download).toHaveBeenCalledExactlyOnceWith(state.release);
});

it('keeps storage failures visible inside the modal', async () => {
  state.ignore.mockRejectedValue(new Error('storage unavailable'));
  press('忽略本版本');
  await vi.waitFor(() => expect(text(StartupUpdatePrompt())).toContain('未能保存，请重试'));
});

it('renders nothing when the startup check has no eligible release', () => {
  state.release = null;
  expect(StartupUpdatePrompt()).toBeNull();
});
