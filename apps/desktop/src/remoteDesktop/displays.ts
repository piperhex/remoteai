import { invoke } from '@tauri-apps/api/core';
import type { DesktopDisplays } from '../../../../shared/remote-desktop/protocol';

type OpenedDesktop = DesktopDisplays & { id: string; nativeOnly?: boolean };

export async function openDesktopCapture(displayId?: string, expiresAt?: number): Promise<OpenedDesktop> {
  const opened = await invoke<string | OpenedDesktop>('remote_desktop_open',
    { displayId, ...(expiresAt === undefined ? {} : { expiresAt }) });
  // Keep the capture fallback usable with hosts that predate display discovery.
  return typeof opened === 'string' ? { id: opened } : opened;
}
