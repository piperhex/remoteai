// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useComputerListRefresh } from '../../../web/src/chat/useComputerListRefresh';
import { setActiveSession } from '../../../web/src/api';
import { ADMIN_REQUEST_TIMEOUT_MS } from '../../../../shared/http/requestDeadline';
import { credentials, json } from '../../../../shared/http/testing/adminClientContract';

const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../../../web/src/hooks', () => ({ useAppDispatch: () => dispatch }));

it('releases the real computer list loading state and allows a second refresh after timeout', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setActiveSession(credentials());
  vi.useFakeTimers();
  let state!: ReturnType<typeof useComputerListRefresh>;
  function Fixture() { state = useComputerListRefresh(); return <output>{String(state.loading)}</output>; }
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    await act(async () => root.render(<Fixture />));
    let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(state.refresh()); });
    expect(state.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS); await pending; });
    expect(state.loading).toBe(false);
    expect(state.error).not.toBe('');
    vi.stubGlobal('fetch', vi.fn(async () => json({ devices: [] })));
    await act(async () => { await state.refresh(); });
    expect(state.loading).toBe(false);
    expect(state.error).toBe('');
    expect(dispatch).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers(); vi.unstubAllGlobals(); setActiveSession(null);
  }
});
