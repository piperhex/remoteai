import { uiText } from "../../../../../shared/localization/uiText";
import { invoke } from '../../api/backend';
import type { RequestSpeed } from '../../../../../shared/remote-chat/composer';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';

const REFRESH_INTERVAL_MS = 5_000;
export interface GuiRequestSettings { speed?: RequestSpeed; fastModeEnabled: boolean; fastModeAvailable: boolean }
export interface RequestSpeedSource {
  read(): Promise<RequestSpeed>;
  set(speed: RequestSpeed): Promise<RequestSpeed>;
  subscribe(listener: (speed: RequestSpeed) => void): () => void;
}

/** Shares the host GUI's independent speed without storing it as a per-conversation preference. */
export class RequestSpeedBridge implements RequestSpeedSource {
  settings?: GuiRequestSettings;
  private value?: RequestSpeed;
  private pending?: Promise<RequestSpeed>;
  private readonly listeners = new Set<(speed: RequestSpeed) => void>();
  private stopWatching?: () => void;

  subscribe(listener: (speed: RequestSpeed) => void) {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.watch();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) { this.stopWatching?.(); this.stopWatching = undefined; }
    };
  }

  private watch() {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => {
      if (stopped) return;
      // A transient status failure keeps the last confirmed mode; the next refresh retries it.
      void this.read().catch(() => undefined);
    };
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    void subscribeGuiEvent('codex-gui-request-settings-changed', refresh).then((stop) => {
      if (stopped) stop(); else unsubscribe = stop;
    }).catch(() => { /* Polling also supports hosts without this event. */ });
    refresh();
    this.stopWatching = () => { stopped = true; clearInterval(timer); unsubscribe?.(); };
  }

  private request(operation: () => Promise<GuiRequestSettings>) {
    // Serialize reads and writes so a slow poll cannot restore the mode preceding a phone change.
    const result = (this.pending ?? Promise.resolve()).catch(() => undefined).then(operation).then((status) => {
      const speed = status.speed ?? (status.fastModeEnabled ? 'fast' : 'normal');
      const changed = speed !== this.value || status.fastModeAvailable !== this.settings?.fastModeAvailable;
      this.settings = status;
      if (changed) {
        this.value = speed;
        for (const listener of this.listeners) listener(speed);
      }
      return speed;
    });
    this.pending = result;
    const clear = () => { if (this.pending === result) this.pending = undefined; };
    void result.then(clear, clear);
    return result;
  }

  read() {
    return this.pending ?? this.request(() => invoke<GuiRequestSettings>('codex_gui_request_settings'));
  }

  set(speed: RequestSpeed) {
    return this.request(async () => {
      try {
        return await invoke<GuiRequestSettings>('codex_gui_set_request_speed', { speed });
      } catch {
        throw new Error(uiText("client.conversation.couldNotChangeTheSpeedModeCheckThatTheDesktop"));
      }
    });
  }
}

export const guiRequestSpeed = new RequestSpeedBridge();
