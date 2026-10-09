import { invoke } from '@tauri-apps/api/core';
import type { DesktopDisplays } from '../../../../shared/remote-desktop/protocol';
import type { ClipboardReply } from '../../../../shared/remote-desktop/clipboard';
import { openDesktopCapture } from './displays';

/** Binary IPC avoids JSON/base64 copies; capture, resize and JPEG encoding run in Rust workers. */
export class DesktopCapture {
  readonly canvas = document.createElement('canvas');
  private id?: string;
  private stopped = false;
  private closing?: Promise<void>;
  displays: DesktopDisplays = {};
  private stream?: MediaStream;
  async open(width: number, displayId?: string, expiresAt?: number) {
    const { id, nativeOnly, ...displays } = await openDesktopCapture(displayId, expiresAt);
    this.id = id; this.displays = displays;
    if (this.stopped) { await this.release(); throw new Error('桌面连接已结束。'); }
    if (nativeOnly) {
      await this.release();
      throw new Error('远程桌面暂不可用，请更新电脑端应用后重试。');
    }
    await this.frame(width);
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.stream = this.canvas.captureStream(0);
    return this.stream;
  }
  async frame(width: number) {
    if (this.stopped || !this.id) return;
    const data = await invoke<ArrayBuffer>('remote_desktop_frame', { id: this.id, width });
    if (this.stopped) return;
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
    try {
      if (this.stopped) return;
      if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
        this.canvas.width = bitmap.width; this.canvas.height = bitmap.height;
      }
      const context = this.canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('暂时无法读取屏幕画面。');
      context.drawImage(bitmap, 0, 0);
      const track = this.stream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      track?.requestFrame();
    } finally { bitmap.close(); }
  }
  async input(input: unknown) {
    if (!this.stopped && this.id) await invoke('remote_desktop_input', { id: this.id, input });
  }
  async renew(expiresAt: number) {
    if (this.id && !this.stopped) await invoke('remote_desktop_renew', { id: this.id, expiresAt });
  }
  async clipboard(message: object) {
    if (this.stopped || !this.id) throw new Error('桌面连接已结束。');
    return invoke<ClipboardReply>('remote_desktop_clipboard', { id: this.id, message });
  }
  private async release() {
    if (!this.id) return this.closing;
    const id = this.id; this.id = undefined;
    this.closing = invoke<void>('remote_desktop_close', { id })
      .catch(() => { /* The native lease also releases held buttons after the WebView exits. */ });
    return this.closing;
  }
  close() {
    this.stopped = true;
    this.stream?.getTracks().forEach(track => track.stop());
    return this.release();
  }
}
