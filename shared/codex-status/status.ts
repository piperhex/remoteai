export const CODEX_STATUS_URL = 'https://status.openai.com/';
export const CODEX_STATUS_OPERATION = 'guiCodexServiceStatus';
export type ServiceHealth = 'operational' | 'disrupted' | 'unknown';
export interface CodexServiceStatus { api: ServiceHealth; cli: ServiceHealth }
export type ReadCodexServiceStatus = () => Promise<CodexServiceStatus>;

export function serviceHealth(status?: CodexServiceStatus): ServiceHealth {
  if (status?.api === 'disrupted' || status?.cli === 'disrupted') return 'disrupted';
  if (status?.api === 'operational' && status?.cli === 'operational') return 'operational';
  return 'unknown';
}
