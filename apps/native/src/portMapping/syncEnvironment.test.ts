import { expect, it, vi } from 'vitest';
import { nativeMappingEnvironment } from './syncEnvironment';
import { MappingSyncPolling } from '../../../../shared/port-mapping/syncPolling';

const app = vi.hoisted(() => ({ currentState: 'active', listener: () => {}, remove: vi.fn() }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return app.currentState; },
  addEventListener: (_event: string, listener: () => void) => {
    app.listener = listener; return { remove: app.remove };
  },
} }));

it('slows native background polling and refreshes immediately after resuming', () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const polling = new MappingSyncPolling(refresh, nativeMappingEnvironment);
  polling.start();
  app.currentState = 'background'; app.listener();
  vi.advanceTimersByTime(60_000); expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000); expect(refresh).toHaveBeenCalledOnce();
  app.currentState = 'active'; app.listener(); expect(refresh).toHaveBeenCalledTimes(2);
  polling.stop(); expect(app.remove).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
