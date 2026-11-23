import { PortForwardingService as SharedService } from '../../../../../../shared/port-mapping/service';
import { DesktopMappingTunnel } from './streamTunnel';
import type { ForwardingClient } from '../../../../../../shared/port-mapping/service';
import type { PortMapping } from './settings';
import { protocolTunnel } from '../../../../../../shared/port-mapping/protocolTunnel';
import { UdpMappingTunnel } from '../../../../../../shared/port-mapping/udpTunnel';
import { listenUdp } from './udpListener';
export type { ForwardingClient, ForwardingEntry } from '../../../../../../shared/port-mapping/service';

export class PortForwardingService extends SharedService {
  constructor(client: ForwardingClient, saved: PortMapping[] = [],
    validateTarget?: (target: Omit<PortMapping, 'id'>, id?: string) => void) {
    super(client, saved, { createId: () => crypto.randomUUID(), validateTarget,
      createTunnel: (connection, options) => protocolTunnel(options.protocol, {
        tcp: () => new DesktopMappingTunnel(connection, options),
        udp: () => new UdpMappingTunnel(connection, options, listenUdp),
      }) });
  }
}
