import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import { PortForwardingService, type ForwardingClient } from '../../../../../shared/port-mapping/service';
import { readPortMappings, savePortMappings } from '../../../../../shared/port-mapping/settings';
import { NativeMappingTunnel } from './tunnel';
import { protocolTunnel } from '../../../../../shared/port-mapping/protocolTunnel';
import { UdpMappingTunnel } from '../../../../../shared/port-mapping/udpTunnel';
import { listenUdp } from './udpListener';
import { adminRequest } from '../../api/client';
import type { AuthSession } from '../../types';
import { mappingSyncScope, type MappingDocument } from '../../../../../shared/port-mapping/sync';
import { useMappingSync } from '../../../../../shared/port-mapping/useMappingSync';
import { useDeviceMapping } from '../../../../../shared/port-mapping/deviceRegistry';
import { nativeMappingEnvironment } from '../../portMapping/syncEnvironment';

const storage = { getItem: (key: string) => Storage.getItemSync(key),
  setItem: (key: string, value: string) => Storage.setItemSync(key, value) };

export function usePortMappings(options: {
  client: ForwardingClient; scope: string; connected: boolean; session?: AuthSession;
}) {
  const { client, scope, connected } = options;
  const managed = useDeviceMapping(mappingSyncScope(scope)?.deviceId ?? '');
  const managedConnection = useSyncExternalStore(managed?.connection.subscribe ?? noSubscribe,
    managed?.connection.snapshot ?? noConnection);
  const managedSync = useSyncExternalStore(managed?.sync.subscribe ?? noSubscribe, managed?.sync.snapshot ?? noStatus);
  const service = useMemo(() => managed?.service ?? new PortForwardingService(client,
    readPortMappings(scope, storage, randomUUID), {
    createId: randomUUID, createTunnel: (connection, config) => protocolTunnel(config.protocol, {
      tcp: () => new NativeMappingTunnel(connection, config),
      udp: () => new UdpMappingTunnel(connection, config, listenUdp),
    }),
  }), [client, scope, managed]);
  const entries = useSyncExternalStore(service.subscribe, service.snapshot);
  const exchange = useMemo(() => {
    const identity = mappingSyncScope(scope);
    const session = options.session;
    if (managed || !identity || !session || session.baseUrl !== identity.baseUrl || session.email !== identity.account) return;
    return (document?: MappingDocument) => adminRequest<MappingDocument>(session,
      `/devices/${encodeURIComponent(identity.deviceId)}/port-mappings`,
      document ? { method: 'PUT', body: JSON.stringify(document) } : {});
  }, [scope, options.session, managed]);
  const syncStatus = useMappingSync(service, { scope, storage, exchange, connected,
    environment: nativeMappingEnvironment });
  useEffect(() => { if (!managed) service.setConnected(connected); }, [service, connected, managed]);
  useEffect(() => {
    if (managed) return;
    service.activate();
    return service.dispose;
  }, [service, managed]);
  useEffect(() => { if (!managed) savePortMappings(scope, entries, storage); }, [scope, entries, managed]);
  return { entries, service, syncStatus: managed ? managedSync : syncStatus,
    connected: managed ? managedConnection.ready : connected };
}

const noSubscribe = () => () => {};
const disconnected = { ready: false, error: '' };
const noConnection = () => disconnected;
const noStatus = () => '';
