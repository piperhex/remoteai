import { t } from '../i18n';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SessionExpiredError extends ApiError {
  constructor(status = 401) {
    super(t('client.app.yourSessionHasExpiredPleaseSignInAgain'), status);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

export async function parseError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('；');
      if (typeof message === 'string') return message;
    }
  } catch {
    // Fall through to the generic status message when the body is not JSON.
  }
  return t('client.app.requestFailedHttp', { value1: response.status });
}
