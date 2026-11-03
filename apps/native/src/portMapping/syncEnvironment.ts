import { AppState } from 'react-native';
import type { MappingSyncEnvironment } from '../../../../shared/port-mapping/syncPolling';

// Native reachability is learned from HTTP failures; AppState resumes immediately after suspension.
export const nativeMappingEnvironment: MappingSyncEnvironment = {
  snapshot: () => ({ online: true, foreground: AppState.currentState === 'active' }),
  subscribe: listener => {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
};
