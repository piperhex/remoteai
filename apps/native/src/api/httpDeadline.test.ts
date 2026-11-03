import { vi } from 'vitest';
import { adminClientContract, credentials } from '../../../../shared/http/testing/adminClientContract';
import { authorizedRequest, refreshSession } from './client';
import { activateSession, sessionEpoch } from './sessionStore';

vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined),
}));
let session = credentials();
adminClientContract({
  setup: async () => { session = credentials(); await activateSession(session, sessionEpoch()); },
  request: (path, init) => authorizedRequest(session, path, init),
  refresh: options => refreshSession(session, options),
  replace: async next => { session = next; await activateSession(session, sessionEpoch()); },
  current: () => session,
});
