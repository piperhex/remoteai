const STORAGE_KEY = 'remote-assistance-revocations';
const MAX_LIFETIME_MS = (2 * 60 + 5) * 60 * 1_000;

export function revokedInvitations(): Set<string> {
  return new Set(Object.keys(read()));
}

/** A failed cloud cancellation must remain revoked after a renderer reload or another login. */
export function rememberRevocation(id: string, expiresAt?: string) {
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  // Acceptance may race a failed cancellation and extend a pending invitation by two hours.
  const until = Math.max(Number.isFinite(expires) ? expires : 0, Date.now() + MAX_LIFETIME_MS);
  const entries = { ...read(), [id]: until };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }
  catch { /* The current renderer still keeps its in-memory revocation if storage is unavailable. */ }
}

function read(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, expires]) =>
      id.length <= 160 && typeof expires === 'number' && Number.isFinite(expires) && expires > Date.now()));
  } catch { return {}; }
}
