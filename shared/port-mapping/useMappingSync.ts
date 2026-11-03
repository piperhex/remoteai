import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { MappingSync, type MappingExchange } from './sync';
import type { MappingStorage } from './settings';
import type { PortForwardingService } from './service';
import type { MappingSyncEnvironment } from './syncPolling';

export function useMappingSync(service: PortForwardingService, options: {
  scope: string; storage: MappingStorage; exchange?: MappingExchange;
  environment?: MappingSyncEnvironment; connected?: boolean;
}) {
  const { scope, storage, exchange, environment, connected } = options;
  const sync = useMemo(() => exchange ? new MappingSync(service, { scope, storage, exchange, environment }) : undefined,
    [service, scope, storage, exchange, environment]);
  const status = useSyncExternalStore(sync?.subscribe ?? noSubscribe, sync?.snapshot ?? noStatus);
  useEffect(() => sync?.start(), [sync]);
  useEffect(() => { if (connected) sync?.requestRefresh(); }, [sync, connected]);
  return status;
}
const noSubscribe = () => () => {};
const noStatus = () => '';
