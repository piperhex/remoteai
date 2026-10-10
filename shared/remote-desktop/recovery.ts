import { desktopPermission, DesktopPermissionWait } from './permissionWait';
import type { DesktopPermissionStatus } from './protocol';

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15_000, 15_000];
const STABLE_CONNECTION_MS = 30_000;
export const DESKTOP_OFFLINE_STATUS = '远程电脑已断开，恢复在线后将自动重连。';

/** Retry a failed desktop without retaining timers after the viewer closes. */
export class DesktopRecovery {
  private failures = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private available = true;
  private pendingFailure?: string;
  private permissionWait?: DesktopPermissionWait;
  constructor(private readonly reconnect: () => void, private readonly status: (text: string) => void,
    private readonly permissions?: () => Promise<DesktopPermissionStatus>) {}

  connected() {
    if (this.stopped) return;
    this.permissionWait?.stop(); this.permissionWait = undefined;
    clearTimeout(this.retryTimer); clearTimeout(this.stableTimer);
    this.retryTimer = undefined; this.pendingFailure = undefined;
    this.stableTimer = setTimeout(() => { this.failures = 0; }, STABLE_CONNECTION_MS);
  }

  failed(message: string) {
    clearTimeout(this.stableTimer);
    if (this.stopped) return;
    const permission = desktopPermission(message);
    if (permission) {
      clearTimeout(this.retryTimer); this.retryTimer = undefined;
      this.permissionWait?.stop(); this.pendingFailure = message;
      this.status(message);
      if (this.permissions) this.permissionWait = new DesktopPermissionWait({ permission, check: this.permissions,
        status: this.status, unavailable: message, ready: () => {
          this.pendingFailure = undefined; this.permissionWait = undefined; this.failures = 0;
          this.status('正在连接桌面…'); this.reconnect();
        } });
      this.permissionWait?.setAvailable(this.available);
      if (!this.available) this.status(DESKTOP_OFFLINE_STATUS);
      return;
    }
    if (this.retryTimer) return;
    this.permissionWait?.stop(); this.permissionWait = undefined;
    this.pendingFailure = message;
    if (!this.available) { this.status(DESKTOP_OFFLINE_STATUS); return; }
    const delay = RETRY_DELAYS[this.failures++];
    if (delay === undefined) { this.status(message); return; }
    this.status('连接已断开，正在重连…');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopped) this.reconnect();
    }, delay);
  }

  /** Chat signaling can go offline while the independent desktop media stays healthy. */
  setAvailable(available: boolean) {
    if (this.stopped || this.available === available) return;
    this.available = available;
    if (!this.pendingFailure) return;
    if (desktopPermission(this.pendingFailure)) {
      this.permissionWait?.setAvailable(available);
      if (!available) this.status(DESKTOP_OFFLINE_STATUS);
      else if (!this.permissionWait) this.status(this.pendingFailure);
      return;
    }
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    if (!available) { this.status(DESKTOP_OFFLINE_STATUS); return; }
    this.failures = 0;
    this.status('正在恢复桌面连接…'); this.reconnect();
  }

  stop() {
    this.stopped = true;
    this.permissionWait?.stop();
    clearTimeout(this.retryTimer); clearTimeout(this.stableTimer);
  }
}
