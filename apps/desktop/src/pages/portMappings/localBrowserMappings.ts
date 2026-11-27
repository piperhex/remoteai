import { browserMappings } from '../../../../../shared/port-mapping/browserMappings';
import { mappingAddress } from '../../../../../shared/port-mapping/target';
import { browserRoutes, type PortForwardingService } from '../codexGui/portForwarding/service';

/** Publish shortcuts only after the native browser has installed their exact destinations. */
export function registerLocalBrowserMappings(scope: string, service: PortForwardingService) {
  let generation = 0;
  let signature = '';
  let unregister: (() => void) | undefined;
  const sync = () => {
    const entries = service.snapshot().filter(row => row.localDomain && row.protocol !== 'udp'
      && row.localDomain !== 'tauri.localhost' && row.localDomain !== 'ipc.localhost');
    const routes = entries.map(row => ({ domain: row.localDomain!, port: row.localPort, target: mappingAddress(row) }));
    const next = JSON.stringify(entries.map((row, i) => [row.id, row.linkProtocol, routes[i]]));
    if (next === signature) return;
    signature = next;
    const current = ++generation;
    unregister?.();
    void browserRoutes.setLocal(routes).then(() => {
      if (generation !== current) return;
      unregister = browserMappings.register(scope, { snapshot: () => entries, subscribe: () => () => {} }, true);
    }, () => { if (generation === current) signature = ''; });
  };
  const unsubscribe = service.subscribe(sync);
  sync();
  return () => {
    generation++;
    unsubscribe();
    unregister?.();
    void browserRoutes.setLocal([]).catch(() => console.warn('Could not clear local browser mappings'));
  };
}
