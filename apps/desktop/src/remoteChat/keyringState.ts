const issues = ['KEYRING_CREATE', 'KEYRING_LOCKED', 'KEYRING_ACCESS', 'KEYRING_SERVICE',
  'KEYRING_SERVICE_DEBIAN', 'KEYRING_SERVICE_FEDORA', 'KEYRING_SERVICE_ARCH'] as const;
export type KeyringIssue = typeof issues[number];
let issue: KeyringIssue | null = null;
const listeners = new Set<() => void>();

function update(next: KeyringIssue | null) {
  if (issue === next) return;
  issue = next;
  for (const listener of listeners) listener();
}

export function reportKeyringIssue(error: unknown) {
  const value = error instanceof Error ? error.message : error;
  const next = issues.find(candidate => candidate === value);
  if (next) update(next);
  return Boolean(next);
}

export const clearKeyringIssue = () => update(null);
export const getKeyringIssue = () => issue;
export function subscribeKeyring(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
