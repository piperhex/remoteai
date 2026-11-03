import { useMemo, type ReactElement } from 'react';
import { randomUUID } from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import { DeviceMappingProvider, DeviceMappingRegistry } from '../../../../shared/port-mapping/deviceRegistry';
import { DeviceMappingRuntime } from '../../../../shared/port-mapping/deviceRuntime';
import { createMappingConnection } from '../../../../shared/port-mapping/connection';
import { protocolTunnel } from '../../../../shared/port-mapping/protocolTunnel';
import { UdpMappingTunnel } from '../../../../shared/port-mapping/udpTunnel';
import type { MappingDocument } from '../../../../shared/port-mapping/sync';
import { MobileChatConnection } from '../chat/connection';
import { NativeMappingTunnel } from '../chat/portMapping/tunnel';
import { listenUdp } from '../chat/portMapping/udpListener';
import { adminRequest } from '../api/client';
import type { AuthSession, RemoteDevice } from '../types';
import { withMappingBackground } from './background';
import { nativeMappingEnvironment } from './syncEnvironment';

const storage = { getItem: (key: string) => Storage.getItemSync(key),
  setItem: (key: string, value: string) => Storage.setItemSync(key, value) };

export function createNativeMappingRegistry(session: AuthSession) {
  return new DeviceMappingRegistry((deviceId, registry) => new DeviceMappingRuntime(
    withMappingBackground(createMappingConnection(events =>
      new MobileChatConnection({ session, deviceId, ...events }))),
    { scope: JSON.stringify([session.baseUrl, session.email, deviceId]), storage, createId: randomUUID,
      environment: nativeMappingEnvironment,
      createTunnel: (connection, options) => protocolTunnel(options.protocol, {
        tcp: () => new NativeMappingTunnel(connection, options),
        udp: () => new UdpMappingTunnel(connection, options, listenUdp),
      }),
      validateTarget: (target, id) => registry.validateTarget(deviceId, target, id),
      exchange: (document?: MappingDocument) => adminRequest<MappingDocument>(session,
        `/devices/${encodeURIComponent(deviceId)}/port-mappings`,
        document ? { method: 'PUT', body: JSON.stringify(document) } : {}),
    }));
}

export function MappingProvider({ session, devices, children }: {
  session: AuthSession; devices: RemoteDevice[]; children: ReactElement;
}) {
  const registry = useMemo(() => createNativeMappingRegistry(session), [session.baseUrl, session.email]);
  return <DeviceMappingProvider registry={registry} deviceIds={devices.map(device => device.deviceId)}>
    {children}
  </DeviceMappingProvider>;
}
