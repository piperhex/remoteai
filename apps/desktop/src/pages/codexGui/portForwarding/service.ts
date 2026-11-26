import { PortForwardingService as SharedService } from '../../../../../../shared/port-mapping/service';
import { DesktopMappingTunnel } from './streamTunnel';
import type { ForwardingClient } from '../../../../../../shared/port-mapping/service';
import type { PortMapping } from './settings';
import { protocolTunnel } from '../../../../../../shared/port-mapping/protocolTunnel';
import { UdpMappingTunnel } from '../../../../../../shared/port-mapping/udpTunnel';
import { listenUdp } from './udpListener';
import { invoke } from '@tauri-apps/api/core';
import { BrowserRoutes } from '../../../../../../shared/port-mapping/browserRoutes';
const browserRoutes = new BrowserRoutes(routes => invoke('configure_browser_mappings', { routes }));
export type { ForwardingClient, ForwardingEntry } from '../../../../../../shared/port-mapping/service';

export class PortForwardingService extends SharedService {
  constructor(client: ForwardingClient, saved: PortMapping[] = [],
    validateTarget?: (target: Omit<PortMapping, 'id'>, id?: string) => void) {
    super(client, saved, { createId: () => crypto.randomUUID(), validateTarget,
      createTunnel: (connection, options) => {
        const tunnel = protocolTunnel(options.protocol, {
          tcp: () => new DesktopMappingTunnel(connection, options),
          udp: () => new UdpMappingTunnel(connection, options, listenUdp),
        });
        return options.protocol === 'udp' ? tunnel : browserRoutes.attach(tunnel, options.localPort);
      } });
  }
}
