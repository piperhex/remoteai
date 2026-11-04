// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../../api/backend';
import { useGuiComputers } from './useGuiComputers';
import type { GuiCloudIdentity, GuiDeviceDirectory } from '../../../../../../shared/conversation/remote/types';

vi.mock('../../../api/backend', () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../../shared/platform/localBackend', async () => await import('../../../api/backend'));
const identity = { baseUrl: 'https://cloud.example', userId: 'owner' };
const device = { deviceId: 'other', name: 'Work PC', platform: 'windows', online: true };
let root: Root;
let container: HTMLDivElement;
let options: { active: boolean; identity: GuiCloudIdentity | null; login: () => void };
let result: ReturnType<typeof useGuiComputers>;
const directory = (owner = identity): GuiDeviceDirectory => ({ identity: owner, currentDeviceId: 'this', devices: [device] });
function Harness() { result = useGuiComputers(options); return null; }
const render = () => act(async () => root.render(<Harness />));

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(invoke).mockReset().mockResolvedValue(directory());
  options = { active: true, identity, login: vi.fn() };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps device polling single-flight and ignores a late response from the previous cloud owner', async () => {
  let finish!: (value: GuiDeviceDirectory) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { result.refresh(); await vi.advanceTimersByTimeAsync(45_000); });
  expect(invoke).toHaveBeenCalledTimes(1);
  options.identity = { ...identity, userId: 'new-owner' };
  vi.mocked(invoke).mockResolvedValue({ ...directory(options.identity), devices: [] });
  await render();
  await act(async () => finish(directory()));
  expect(result.devices).toEqual([]);
  expect(result.loading).toBe(false);
});

it('retains the selected computer through offline polls and clears it for another login', async () => {
  await render();
  await act(async () => result.choose(device));
  expect(result.current?.deviceId).toBe('other');
  vi.mocked(invoke).mockResolvedValue({ ...directory(), devices: [{ ...device, online: false }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(result.current?.deviceId).toBe('other');
  await act(async () => result.choose(null));
  await act(async () => result.choose({ ...device, online: false }));
  expect(result.current).toBeNull();
  options.identity = null; await render();
  expect(result.current).toBeNull(); expect(result.authenticated).toBe(false);
});

it('stops timers on leaving the page and can return to local even when a refresh fails', async () => {
  await render(); await act(async () => result.choose(device));
  vi.mocked(invoke).mockRejectedValue(new Error('private transport error'));
  await act(async () => result.refresh());
  expect(result.error).toBe('暂时无法读取电脑列表，请重试。');
  expect(result.current?.deviceId).toBe('other');
  options.active = false; await render();
  const count = vi.mocked(invoke).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); result.choose(null); });
  expect(invoke).toHaveBeenCalledTimes(count); expect(result.current).toBeNull();
});
