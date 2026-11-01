import type { ProjectWindowRequest } from './protocol';

const INVALID_WINDOW = 'client.projectBrowser.unableToReadThisFilePleaseTryAgain';

/** Validate the embedded viewer's paging capability without trusting its path or offsets. */
export function windowRequest(value: unknown): ProjectWindowRequest | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID_WINDOW);
  const input = value as Record<string, unknown>;
  if (typeof input.token !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input.token)) {
    throw new Error(INVALID_WINDOW);
  }
  for (const name of ['offset', 'end']) {
    if (input[name] !== undefined && (!Number.isSafeInteger(input[name]) || Number(input[name]) < 0)) {
      throw new Error(INVALID_WINDOW);
    }
  }
  for (const name of ['open', 'cancel']) {
    if (input[name] !== undefined && typeof input[name] !== 'boolean') throw new Error(INVALID_WINDOW);
  }
  return { token: input.token, offset: input.offset as number | undefined, end: input.end as number | undefined,
    open: input.open as boolean | undefined, cancel: input.cancel as boolean | undefined };
}
