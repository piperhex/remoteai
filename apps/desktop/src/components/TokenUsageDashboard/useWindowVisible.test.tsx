// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWindowVisible } from '../../../../../shared/token-usage/useWindowVisible';

const native = vi.hoisted(() => ({ visible: true, minimized: false,
  events: new Map<string, () => void>(), unlisten: vi.fn(), readVisible: vi.fn<() => Promise<boolean>>() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  isVisible: native.readVisible, isMinimized: async () => native.minimized,
  onFocusChanged: async (listener: () => void) => { native.events.set('focus', listener); return native.unlisten; },
  onResized: async (listener: () => void) => { native.events.set('resize', listener); return native.unlisten; },
}) }));
let root: Root;
let visible = true;
function Probe({ active = true }: { active?: boolean }) { visible = useWindowVisible(active); return null; }
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  native.visible = true;
  native.readVisible.mockReset().mockImplementation(async () => native.visible);
  native.minimized = false;
  native.unlisten.mockClear();
  native.events.clear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('pauses minimized and hidden native windows while retaining visible unfocused windows', async () => {
  await act(async () => root.render(<Probe />));
  expect(visible).toBe(true);
  await act(async () => { native.events.get('focus')?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(visible).toBe(true);
  await act(async () => { native.minimized = true; native.events.get('resize')?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(visible).toBe(false);
  await act(async () => { native.minimized = false; native.events.get('focus')?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(visible).toBe(true);
  await act(async () => { native.visible = false; native.events.get('focus')?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(visible).toBe(false);
  await act(async () => root.render(null));
  expect(native.unlisten).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('rechecks a window change received while the previous state query is still pending', async () => {
  await act(async () => root.render(<Probe />));
  let release!: (value: boolean) => void;
  native.readVisible.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { native.events.get('focus')?.(); await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { native.minimized = true; native.events.get('resize')?.(); await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { release(true); await vi.advanceTimersByTimeAsync(1); });
  expect(visible).toBe(false);
  expect(native.readVisible).toHaveBeenCalledTimes(3);
});

it('starts only while selected, observes silent hide/show and clears the state timer when leaving', async () => {
  await act(async () => root.render(<Probe active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(native.readVisible).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe />));
  await act(async () => { native.visible = false; await vi.advanceTimersByTimeAsync(1000); });
  expect(visible).toBe(false);
  await act(async () => { native.visible = true; await vi.advanceTimersByTimeAsync(1000); });
  expect(visible).toBe(true);
  const calls = native.readVisible.mock.calls.length;
  await act(async () => root.render(<Probe active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(native.readVisible).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not overlap slow state queries or restart after unmounting with a late response', async () => {
  let release!: (value: boolean) => void;
  native.readVisible.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await act(async () => root.render(<Probe />));
  await act(async () => {
    native.events.get('focus')?.();
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(native.readVisible).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  await act(async () => { release(true); await vi.advanceTimersByTimeAsync(5000); });
  expect(native.readVisible).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(visible).toBe(false);
});
