import { uiText } from "../../../../../shared/localization/uiText";

// Outlast the 130-second model/list RPC, including official and Admin discovery.
export const MODEL_CATALOG_TIMEOUT_MS = 140_000;

/** Bound waits before the backend timeout starts; callers must still ignore late IPC replies. */
export async function withModelCatalogTimeout<T>(
  pending: Promise<T>, signal: AbortSignal, timeoutMs = MODEL_CATALOG_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(new Error(uiText("client.conversation.modelsAreSyncingPleaseTryAgainShortly")));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error(uiText("client.chat.loadingModelsTimedOutPleaseTryAgain"))), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}
