import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useIdleAppUpdate } from './useIdleAppUpdate';

const state = vi.hoisted(() => ({ effect: null as (() => (() => void) | undefined) | null,
  app: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  wifi: vi.fn(), refresh: vi.fn(), check: vi.fn(), start: vi.fn(), ignored: vi.fn() }));
vi.mock('react', () => ({ useRef: (current: unknown) => ({ current }),
  useEffect: (effect: typeof state.effect) => { state.effect = effect; } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: state.app }));
vi.mock('./androidSharedDownload', () => ({ canAutoDownload: state.wifi }));
vi.mock('./appUpdate', () => ({ checkForAppUpdate: state.check, refreshAndroidUpdateDownloadState: state.refresh,
  startAndroidUpdateDownload: state.start }));
vi.mock('./startupUpdate', () => ({ startupUpdateOptions: { readIgnoredVersion: state.ignored } }));
const release = { version: '2.0.0', androidAsset: { name: 'android.apk' } };
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); state.app.currentState = 'active';
  state.wifi.mockResolvedValue(true); state.refresh.mockResolvedValue({ status: 'idle' });
  state.check.mockResolvedValue({ updateAvailable: true, release }); state.ignored.mockResolvedValue(null);
});
afterEach(() => { cleanup?.(); vi.useRealTimers(); });
function mount() { const touch = useIdleAppUpdate(); cleanup = state.effect?.(); return touch; }

it('automatically prepares a new release once after an idle minute, always with Wi-Fi enforced', async () => {
  mount();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.start).toHaveBeenCalledExactlyOnceWith(release, { wifiOnly: true });
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(state.check).toHaveBeenCalledOnce();
});

it.each(['cellular', 'background', 'ignored', 'downloaded'])('does not start when %s', async reason => {
  if (reason === 'cellular') state.wifi.mockResolvedValue(false);
  if (reason === 'background') state.app.currentState = 'background';
  if (reason === 'ignored') state.ignored.mockResolvedValue(release.version);
  if (reason === 'downloaded') state.refresh.mockResolvedValue({ status: 'downloaded' });
  mount(); await vi.advanceTimersByTimeAsync(60_000);
  expect(state.start).not.toHaveBeenCalled();
});

it('rechecks user activity and Wi-Fi after a slow version query', async () => {
  let resolve!: (value: unknown) => void;
  state.check.mockReturnValue(new Promise(done => { resolve = done; }));
  const touch = mount();
  await vi.advanceTimersByTimeAsync(60_000);
  touch(); state.wifi.mockResolvedValue(false);
  resolve({ updateAvailable: true, release });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.start).not.toHaveBeenCalled();
});
