import { createRoot } from 'react-dom/client';
import { useDesktopLounge } from '../src/lounge/useDesktopLounge';
import { useLoungeTray } from '../src/lounge/useLoungeTray';
import type { CloudAuthState } from '../src/types';

const receiver = { id: 'receiver', account: 'receiver' };
const muted = { id: 'muted', account: 'muted' };
const auth: CloudAuthState = {
  enabled: true, authenticated: true, baseUrl: 'https://lounge-tray.test', userId: receiver.id,
  userEmail: 'receiver@lounge-tray.test', lastSyncAt: null, sessionExpired: false,
};

function avatar() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#d08865';
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#fff4de';
  context.fillRect(5, 5, 16, 16);
  return canvas.toDataURL('image/png');
}

class FixtureSocket {
  static readonly OPEN = 1;
  readonly readyState = FixtureSocket.OPEN;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;

  constructor() { queueMicrotask(() => this.onopen?.()); }

  send(data: string) {
    const { type } = JSON.parse(data) as { type?: string };
    if (type === 'ping') { queueMicrotask(() => this.frame({ type: 'pong' })); return; }
    if (type !== 'authenticate') return;
    queueMicrotask(() => {
      this.frame({ type: 'ready', user: receiver, direct: true, receipts: true,
        notificationSettings: true, mutedConversations: [muted.id] });
      const sender = { id: 'sender', account: 'test-sender', nickname: '测试联系人', avatar: avatar() };
      this.message(muted, 'Muted private message', true);
      this.message(sender, 'Group message', false);
      this.message(sender, '第一条未读私聊', true);
      this.message(sender, '第二条未读私聊', true);
    });
  }

  close() {}

  private frame(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }

  private message(sender: typeof muted, text: string, direct: boolean) {
    this.frame({ type: 'message', id: crypto.randomUUID(), sentAt: new Date().toISOString(),
      sender, text, images: [], ...(direct && { recipient: receiver, receipts: true }) });
  }
}

Object.defineProperty(window, 'WebSocket', { value: FixtureSocket });
localStorage.setItem('codex-switch:language', 'zh');
const openLounge = () => undefined;

function TrayFixture() {
  const lounge = useDesktopLounge(auth);
  useLoungeTray(lounge.controller, openLounge);
  return null;
}

createRoot(document.getElementById('root')!).render(<TrayFixture />);
