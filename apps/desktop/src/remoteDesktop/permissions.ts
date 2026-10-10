import { invoke } from '@tauri-apps/api/core';
import type { ComputerUsePermissions } from '../api/computerUse';
import type { DesktopPermissionStatus, DesktopPermissions } from '../../../../shared/remote-desktop/protocol';

/** Only inspect grants here. Capture startup owns automatic prompts; status polling never opens settings. */
export async function desktopPermissionStatus(): Promise<DesktopPermissionStatus> {
  const [policy, grants] = await Promise.all([
    invoke<DesktopPermissions>('remote_desktop_permissions'),
    invoke<ComputerUsePermissions | null>('remote_desktop_system_permissions'),
  ]);
  if (!policy.enabled) throw new Error('这台电脑未允许此远程操作，请在电脑的设置中调整。');
  if (grants && !grants.screenRecording) return { required: 'screenRecording' };
  if (grants && policy.control && !grants.accessibility) return { required: 'accessibility' };
  return { required: null };
}
