import { useMemo, useSyncExternalStore } from 'react';
import type { GuiComputer } from '../../../../../shared/conversation/remote/types';
import type { ForwardingEntry } from '../codexGui/portForwarding/service';
import { useMappingSessions } from './MappingSessions';
import type { DesktopMappingSession } from './DesktopMappingSession';

export interface MappingGroup { device: GuiComputer; session: DesktopMappingSession; entries: ForwardingEntry[] }

export function useMappingGroups(devices: GuiComputer[]) {
  const sessions = useMappingSessions();
  const store = useMemo(() => {
    const groups = devices.flatMap(device => {
      const session = sessions?.get(device.deviceId);
      return session ? [{ device, session }] : [];
    });
    const read = () => groups.map(group => ({ ...group, entries: group.session.service.snapshot() }));
    let previous = read();
    return {
      subscribe(listener: () => void) {
        const stops = groups.map(({ session }) => session.service.subscribe(listener));
        return () => stops.forEach(stop => stop());
      },
      snapshot() {
        if (previous.some(group => group.entries !== group.session.service.snapshot())) previous = read();
        return previous;
      },
    };
  }, [sessions, devices]);
  return useSyncExternalStore(store.subscribe, store.snapshot);
}
