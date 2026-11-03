import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { PortForwardingService, type ForwardingClient } from './service';
import { readPortMappings, savePortMappings } from './settings';
import { invoke } from '@tauri-apps/api/core';
import { mappingSyncScope, type MappingDocument } from '../../../../../../shared/port-mapping/sync';
import { useMappingSync } from '../../../../../../shared/port-mapping/useMappingSync';

export function usePortForwarding(options: { client: ForwardingClient; scope: string; connected: boolean }) {
  const { client, scope, connected } = options;
  const service = useMemo(() => new PortForwardingService(client, readPortMappings(scope)), [client, scope]);
  const entries = useSyncExternalStore(service.subscribe, service.snapshot);
  const exchange = useMemo(() => {
    const identity = mappingSyncScope(scope);
    if (!identity) return;
    return (document?: MappingDocument) => invoke<MappingDocument>('sync_port_mappings', {
      identity: { baseUrl: identity.baseUrl, userId: identity.account }, deviceId: identity.deviceId, document,
    });
  }, [scope]);
  const syncStatus = useMappingSync(service, { scope, storage: localStorage, exchange, connected });
  useEffect(() => { service.setConnected(connected); }, [service, connected]);
  useEffect(() => { service.activate(); return service.dispose; }, [service]);
  useEffect(() => { savePortMappings(scope, entries); }, [scope, entries]);
  return { entries, service, syncStatus };
}
