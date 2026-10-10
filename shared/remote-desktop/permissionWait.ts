import { desktopFailure } from './diagnostics';
import type { DesktopPermissionStatus, DesktopSystemPermission } from './protocol';

const POLL_INTERVAL_MS = 3000;
const WAITING: Record<DesktopSystemPermission, string> = {
  screenRecording: '请在 Mac 上允许屏幕录制，必要时重启 Remote AI，随后将自动连接。已开启仍无效？请在 Mac 的远程设置中修复权限。',
  accessibility: '请在 Mac 上允许辅助功能，必要时重启 Remote AI，随后将自动连接。已开启仍无效？请在 Mac 的远程设置中修复权限。',
};

export function desktopPermission(message: string): DesktopSystemPermission | undefined {
  const code = desktopFailure(message).desktopError;
  if (code === 'screen-permission') return 'screenRecording';
  if (code === 'accessibility-permission') return 'accessibility';
}

export function waitingForDesktopPermission(message: string) {
  return Object.values(WAITING).includes(message);
}

interface Options {
  permission: DesktopSystemPermission;
  check: () => Promise<DesktopPermissionStatus>;
  status: (message: string) => void;
  ready: () => void;
  unavailable: string;
}

/** Wait without opening capture. The owner stops this poll when the viewer closes or changes hosts. */
export class DesktopPermissionWait {
  private stopped = false;
  private available = true;
  private checking = false;
  private timer?: ReturnType<typeof setTimeout>;
  private message: string;

  constructor(private readonly options: Options) {
    this.message = WAITING[options.permission];
    this.options.status(this.message);
    this.schedule();
  }

  setAvailable(available: boolean) {
    this.available = available;
    clearTimeout(this.timer);
    if (available) {
      this.options.status(this.message);
      this.schedule();
    }
  }

  private schedule() {
    if (!this.stopped && this.available && !this.checking) {
      this.timer = setTimeout(() => { void this.check(); }, POLL_INTERVAL_MS);
    }
  }

  private async check() {
    if (this.stopped || !this.available || this.checking) return;
    this.checking = true;
    try {
      const result = await this.options.check();
      if (this.stopped || !this.available) return;
      if (!result || ![null, 'screenRecording', 'accessibility'].includes(result.required)) {
        this.finish(this.options.unavailable); return;
      }
      // A newly granted screen permission may expose the next required grant (Accessibility).
      if (result.required !== this.options.permission) { this.stop(); this.options.ready(); }
    } catch (error) {
      if (this.stopped || !this.available) return;
      const message = error instanceof Error ? error.message : String(error);
      if (['不支持的远程桌面操作。', '桌面连接信息无效，请重新连接。'].includes(message)) {
        this.finish(this.options.unavailable);
      } else if (desktopFailure(error).desktopError === 'desktop-disabled') this.finish(message);
      // Transient RPC failures keep the current permission explanation and retry only this read.
    } finally { this.checking = false; this.schedule(); }
  }

  private finish(message: string) { this.stop(); this.message = message; this.options.status(message); }

  stop() { this.stopped = true; clearTimeout(this.timer); }
}
