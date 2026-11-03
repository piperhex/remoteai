import type { ProjectPickerProps } from '../remote-chat/projectDirectories';

export const DIRECTORY_LOAD_TIMEOUT_MS = 15_000;

/** Bound local IPC and older hosts that may never settle a filesystem request. */
export async function loadDirectory(load: ProjectPickerProps['load'], directory: string, includeFiles = false) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => load(directory, includeFiles)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Directory request timed out')), DIRECTORY_LOAD_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
