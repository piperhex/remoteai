import { check, type Update } from "@tauri-apps/plugin-updater";
import { AppUpdateCheckTimeoutError } from "./appUpdateErrors";
import { enablePeerDownload } from "./appUpdateDownload";

const UPDATE_CHECK_REQUEST_TIMEOUT_MS = 10_000;
export const UPDATE_CHECK_DEADLINE_MS = 30_000;
const UPDATE_CHECK_RETRY_DELAYS_MS = [500, 1_500] as const;

function isTimeoutError(error: unknown): boolean {
  return /timed out|timeout/i.test(String(error));
}

function isRetryableCheckError(error: unknown): boolean {
  return /error sending request|network|timed out|timeout|connection|dns|tcp|tls/i.test(String(error));
}

async function checkWithRetries(isExpired: () => boolean): Promise<Update | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const update = await check({ timeout: UPDATE_CHECK_REQUEST_TIMEOUT_MS });
      if (!isExpired()) return update ? enablePeerDownload(update) : null;
      // A timed-out IPC call can still return a resource; never let it replace the pending download.
      await update?.close();
      throw new AppUpdateCheckTimeoutError();
    } catch (error) {
      const retryDelay = UPDATE_CHECK_RETRY_DELAYS_MS[attempt];
      if (isExpired() || retryDelay === undefined || !isRetryableCheckError(error)) {
        if (isTimeoutError(error)) throw new AppUpdateCheckTimeoutError();
        throw error;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelay));
      if (isExpired()) throw new AppUpdateCheckTimeoutError();
    }
  }
}

export async function checkAvailableAppUpdate(): Promise<Update | null> {
  let expired = false;
  let timer: number | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      expired = true;
      reject(new AppUpdateCheckTimeoutError());
    }, UPDATE_CHECK_DEADLINE_MS);
  });
  try {
    // Bound retries and IPC waiting as well as the native network request.
    return await Promise.race([checkWithRetries(() => expired), deadline]);
  } finally {
    window.clearTimeout(timer);
  }
}
