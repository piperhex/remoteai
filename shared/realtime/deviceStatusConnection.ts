import { ReconnectBackoff, type ReconnectBackoffOptions } from './reconnectBackoff';

const AUTH_TIMEOUT_MS = 15_000;
const ERROR_GRACE_MS = 250;
type StatusSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>;
interface Options {
  url: string | (() => string);
  subscribe: () => string;
  connecting?: () => void;
  /** Returns true only for the authenticated devices snapshot. */
  message: (data: unknown) => boolean;
  recoverAuthentication?: () => Promise<void>;
  createSocket?: (url: string) => StatusSocket;
  retry?: ReconnectBackoffOptions;
}

/** Shared browser/native subscription lifecycle; the host still owns credentials and device state. */
export class DeviceStatusConnection {
  private readonly backoff: ReconnectBackoff;
  private socket?: StatusSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private errorTimer?: ReturnType<typeof setTimeout>;
  private active = false;
  private foreground = true;
  private recovering = false;

  constructor(private readonly options: Options) {
    this.backoff = new ReconnectBackoff({ maximumMs: 15_000, ...options.retry });
  }

  start() { if (!this.active) { this.active = true; this.connect(); } }
  stop() { this.active = false; this.disconnect(); }
  setForeground(value: boolean) {
    if (this.foreground === value) return;
    this.foreground = value;
    if (value) this.retryNow();
    else this.disconnect();
  }
  retryNow = () => {
    if (!this.active || !this.foreground || this.socket || this.recovering) return;
    clearTimeout(this.retry); this.retry = undefined;
    this.connect();
  };

  private connect() {
    if (!this.active || !this.foreground || this.socket || this.recovering) return;
    try {
      this.options.connecting?.();
      const url = typeof this.options.url === 'function' ? this.options.url() : this.options.url;
      const socket = (this.options.createSocket ?? (url => new WebSocket(url)))(url);
      this.socket = socket;
      this.deadline = setTimeout(() => this.failed(), AUTH_TIMEOUT_MS);
      socket.onopen = () => {
        if (this.socket !== socket) return;
        try { socket.send(this.options.subscribe()); } catch { this.failed(); }
      };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        if (this.options.message(event.data)) { clearTimeout(this.deadline); this.backoff.reset(); }
      };
      socket.onclose = event => { if (this.socket === socket) this.failed(event.code); };
      socket.onerror = () => {
        if (this.socket !== socket || this.errorTimer) return;
        // Preserve an authentication close reason when error and close are delivered together.
        this.errorTimer = setTimeout(() => this.failed(), ERROR_GRACE_MS);
      };
    } catch { this.failed(); }
  }

  private failed(code?: number) {
    this.disconnect();
    if (!this.active || !this.foreground) return;
    if (code === 4001 && this.options.recoverAuthentication) {
      this.recovering = true;
      void this.options.recoverAuthentication().catch(() => {
        // The host reports expired credentials; transient recovery failures use the same backoff.
      }).finally(() => {
        this.recovering = false;
        this.schedule();
      });
    } else this.schedule();
  }

  private schedule() {
    if (!this.active || !this.foreground || this.retry || this.socket) return;
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, this.backoff.next());
  }

  private disconnect() {
    clearTimeout(this.retry); clearTimeout(this.deadline); clearTimeout(this.errorTimer);
    this.retry = this.deadline = this.errorTimer = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(1000);
    }
  }
}
