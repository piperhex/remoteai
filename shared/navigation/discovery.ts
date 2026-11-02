export const discoveryEntries = [
  { page: 'lounge', label: 'client.lounge.title' },
  { page: 'port-mappings', label: 'client.portForwarding.portMapping' },
  { page: 'devices', label: 'client.app.devices' },
  { page: 'ssh', label: 'client.discovery.ssh' },
  { page: 'totp', label: 'client.discovery.twoFactor' },
  { page: 'downloads', label: 'client.downloads.downloads' },
  { page: 'token-summary', label: 'client.chat.tokenSummary' },
] as const;

export type DiscoveryPage = typeof discoveryEntries[number]['page'];

export function isDiscoveryPage(page: string): page is DiscoveryPage {
  return discoveryEntries.some(entry => entry.page === page);
}

export function primaryNavigationPage(page: string): string {
  return isDiscoveryPage(page) ? 'discover' : page;
}
