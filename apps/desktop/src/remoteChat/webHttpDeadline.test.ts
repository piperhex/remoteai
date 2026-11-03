// @vitest-environment jsdom
import { adminClientContract, credentials } from '../../../../shared/http/testing/adminClientContract';
import { authorizedFetch, getActiveSession, refreshSession, setActiveSession } from '../../../web/src/api';

adminClientContract({
  setup: async () => setActiveSession(credentials()),
  request: authorizedFetch,
  refresh: refreshSession,
  replace: async session => setActiveSession(session),
  current: getActiveSession,
});
