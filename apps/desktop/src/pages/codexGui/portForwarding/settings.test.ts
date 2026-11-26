// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readPortMappings, savePortMappings } from './settings';
import { mappingConfig, mappingConflicts } from '../../../../../../shared/port-mapping/settings';
import { localMappingAddress } from '../../../../../../shared/port-mapping/target';

beforeEach(() => localStorage.clear());

it('restores the optional domain in the saved and synchronized configuration', () => {
  const entry = { id: 'custom', remotePort: 3000, localPort: 13000, localDomain: ' App.Localhost ' };
  savePortMappings('scope', [entry]);
  const [restored] = readPortMappings('scope');
  expect(localMappingAddress(restored)).toBe('app.localhost:13000');
  expect(mappingConfig(restored)).toHaveProperty('localDomain', 'app.localhost');
  expect(readPortMappings('another')).toEqual([]);
  savePortMappings('scope', [{ ...entry, localDomain: '' }]);
  expect(localMappingAddress(readPortMappings('scope')[0])).toBe('127.0.0.1:13000');
});

it('preserves protocols, accepts separate TCP/UDP on one port, and rejects overlapping or invalid protocols', () => {
  const tcp = { id: 'tcp', remotePort: 53, localPort: 1053, protocol: 'tcp' as const };
  const udp = { ...tcp, id: 'udp', protocol: 'udp' as const };
  savePortMappings('scope', [tcp, udp]);
  expect(readPortMappings('scope').map(value => value.protocol)).toEqual(['tcp', 'udp']);
  expect(mappingConflicts(tcp, udp)).toBe(false);
  expect(mappingConflicts(tcp, { ...udp, protocol: 'both' })).toBe(true);
  expect(mappingConflicts({ ...tcp, protocol: undefined }, tcp)).toBe(true);
  localStorage.setItem('codex-port-forwarding:bad', JSON.stringify([{ ...tcp, protocol: 'icmp' }]));
  expect(readPortMappings('bad')).toEqual([]);
});
it('keeps configuration separate by account and device without restoring active connections', () => {
  savePortMappings('account/computer-one', [{ id: 'one', remotePort: 5432, localPort: 15432 }]);
  expect(readPortMappings('account/computer-two')).toEqual([]);
  expect(readPortMappings('another-account/computer-one')).toEqual([]);
  expect(readPortMappings('account/computer-one')).toEqual([
    { id: expect.any(String), remoteHost: '127.0.0.1', remotePort: 5432, localPort: 15432 },
  ]);
});
it('discards malformed, out-of-range and duplicate stored ports', () => {
  localStorage.setItem('codex-port-forwarding:scope', JSON.stringify([
    null, { remotePort: '3000', localPort: 3000 }, { remotePort: 3000, localPort: 0 },
    { remotePort: 65536, localPort: 3000 }, { remotePort: 3000, localPort: 13000 },
    { remotePort: 4000, localPort: 13000 },
  ]));
  expect(readPortMappings('scope')).toEqual([
    { id: expect.any(String), remoteHost: '127.0.0.1', remotePort: 3000, localPort: 13000 },
  ]);
});

it('persists custom targets and discards invalid hosts without losing valid mappings', () => {
  const mappings = [
    { id: 'one', remoteHost: '192.168.1.20', remotePort: 3000, localPort: 13000 },
    { id: 'two', remoteHost: '::1', remotePort: 3000, localPort: 13001 },
  ];
  savePortMappings('scope', mappings);
  expect(readPortMappings('scope')).toEqual(mappings.map(entry => ({ ...entry, id: expect.any(String) })));
  localStorage.setItem('codex-port-forwarding:scope', JSON.stringify([
    { remoteHost: 'http://1.2.3.4', remotePort: 80, localPort: 80 },
    { remoteHost: null, remotePort: 80, localPort: 80 }, ...mappings,
  ]));
  expect(readPortMappings('scope')).toHaveLength(2);
});

it('restores different IPs on the same preview port while rejecting duplicate targets', () => {
  const entries = ['192.168.1.20', '192.168.1.21', '192.168.1.20']
    .map(remoteHost => ({ id: remoteHost, remoteHost, remotePort: 3000, localPort: 3000 }));
  savePortMappings('scope', entries);
  expect(readPortMappings('scope', undefined, undefined, 'preview').map(entry => entry.remoteHost))
    .toEqual(['192.168.1.20', '192.168.1.21']);
  expect(readPortMappings('scope')).toHaveLength(1);
});
