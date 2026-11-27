import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { GuiCloudIdentity, GuiComputer } from '../../../../../shared/conversation/remote/types';
import { mappingConflicts, type PortMapping } from '../../../../../shared/port-mapping/settings';
import { DesktopMappingSession } from './DesktopMappingSession';

type Sessions = ReadonlyMap<string, DesktopMappingSession>;
export const MappingSessionsContext = createContext<Sessions | null>(null);
export const useMappingSessions = () => useContext(MappingSessionsContext);

function DeviceWorker({ session, online }: { session: DesktopMappingSession; online: boolean }) {
  useEffect(session.mount, [session]);
  useEffect(() => { session.setOnline(online); }, [session, online]);
  return null;
}

/** Keep listeners alive across dashboard navigation and release removed devices and signed-out accounts. */
export function MappingSessions({ identity, devices, localDevice, children }: {
  identity: GuiCloudIdentity | null; devices: GuiComputer[]; localDevice?: GuiComputer; children: ReactNode;
}) {
  const account = identity?.userId;
  const baseUrl = identity?.baseUrl;
  const current = useRef<Sessions>(new Map());
  const consumer = useRef(localDevice);
  useLayoutEffect(() => { consumer.current = localDevice; }, [localDevice]);
  const sessions = useMemo(() => {
    const next = new Map<string, DesktopMappingSession>();
    if (!account || !baseUrl) return next;
    for (const { deviceId: id } of devices) {
      const existing = current.current.get(id);
      const local = localDevice?.deviceId === id;
      const validate = (target: Omit<PortMapping, 'id'>) => {
        if (local) return;
        for (const [other, session] of current.current) {
          if (!session.local && other !== id && session.service.snapshot().some(entry => mappingConflicts(entry, target))) {
            throw new Error('client.mappingHub.portConflict');
          }
        }
      };
      next.set(id, existing?.local === local && existing.scope === JSON.stringify([baseUrl, account, id]) ? existing
        : new DesktopMappingSession({ identity: { baseUrl, userId: account }, deviceId: id, local, validate,
          consumer: () => consumer.current }));
    }
    return next;
  }, [devices, localDevice, baseUrl, account]);
  useLayoutEffect(() => { current.current = sessions; }, [sessions]);
  return <MappingSessionsContext.Provider value={sessions}>
    {devices.map(device => {
      const session = sessions.get(device.deviceId);
      return session && <DeviceWorker key={session.scope} session={session} online={device.online} />;
    })}
    {children}
  </MappingSessionsContext.Provider>;
}
