import { useEffect, useMemo, useRef, useState } from 'react';
import { DesktopReceiver } from './receiver';
import { DesktopPointer } from './input';
import { DesktopRecovery, DESKTOP_OFFLINE_STATUS } from './recovery';
import { DesktopDirectRetry } from './directRetry';
import { changeDesktopDisplay } from './displayActions';
import { waitingForDesktopPermission } from './permissionWait';
import type { ClipboardContent, ClipboardProgress } from './clipboard';
import { DEFAULT_SETTINGS, validateSettings, type DesktopCapabilities, type DesktopClient, type DesktopDisplay,
  type DesktopResolution, type DesktopSettings, type DesktopStats }
  from './protocol';

interface Options {
  client: DesktopClient;
  active: boolean;
  connected?: boolean;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
}
export function useDesktopSession({ client, active, connected = true, createPeer }: Options) {
  const available = useRef(connected); available.current = connected;
  const receiver = useRef<DesktopReceiver>();
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const closing = useRef(Promise.resolve());
  const updating = useRef(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [displays, setDisplays] = useState<DesktopDisplay[]>([]);
  const [resolutions, setResolutions] = useState<DesktopResolution[]>([]);
  const [stream, setStream] = useState<MediaStream>();
  const [status, setStatus] = useState('正在连接桌面…');
  const [stats, setStats] = useState<DesktopStats>();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [privacyScreen, setPrivacyScreen] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [capabilities, setCapabilities] = useState<DesktopCapabilities>({});
  const pointer = useMemo(() => new DesktopPointer(input => receiver.current?.input(input)), []);
  const recovery = useRef<DesktopRecovery>();
  const directRetry = useMemo(() => new DesktopDirectRetry(), [client, active, createPeer]);

  useEffect(() => {
    if (!active) return;
    const controller = new DesktopRecovery(() => setAttempt(value => value + 1), setStatus, client.permissionStatus);
    controller.setAvailable(available.current);
    recovery.current = controller;
    return () => { recovery.current?.stop(); recovery.current = undefined; };
  }, [client, active, createPeer]);

  useEffect(() => { recovery.current?.setAvailable(connected); }, [connected]);

  useEffect(() => {
    setStream(undefined); setStats(undefined); setHasAudio(false); setCapabilities({}); setPrivacyScreen(false);
    setResolutions([]);
    if (!active) return;
    if (!available.current) { recovery.current?.failed(DESKTOP_OFFLINE_STATUS); return; }
    const session = new DesktopReceiver({ client, createPeer, directRetry, stream: setStream, status: setStatus,
      connected: () => recovery.current?.connected(),
      failed: message => { pointer.release(); recovery.current?.failed(message); },
      stats: setStats, audio: setHasAudio, capabilities: setCapabilities, displays: value => {
        setPrivacyScreen(value.privacyScreen === true);
        setDisplays(value.displays ?? []);
        setResolutions(value.resolutions ?? []);
        settingsRef.current = { ...settingsRef.current, displayId: value.displayId };
        setSettings(settingsRef.current);
      } });
    session.mute(mutedRef.current);
    receiver.current = session;
    void closing.current.then(() => { if (receiver.current === session) return session.start(settingsRef.current); });
    return () => {
      pointer.release(); receiver.current = undefined; pointer.dispose(); closing.current = session.stop();
    };
  }, [client, active, createPeer, pointer, attempt, directRetry]);

  const update = async (next: DesktopSettings) => {
    if (updating.current) return;
    const current = receiver.current;
    if (!current) return;
    if (privacyScreen && next.displayId !== settingsRef.current.displayId) return;
    try {
      validateSettings(next); updating.current = true; setSaving(true);
      if (next.displayId !== settingsRef.current.displayId) {
        pointer.release(); setStatus('正在切换显示器…');
        closing.current = current.stop(); await closing.current;
        if (receiver.current !== current) return;
        settingsRef.current = next; setSettings(next); setAttempt(value => value + 1);
        return;
      }
      await current.settings(next);
      if (receiver.current !== current) return;
      settingsRef.current = next; setSettings(next);
    } catch (error) { setStatus(error instanceof Error ? error.message : '显示设置未能保存，请重试。'); }
    finally { updating.current = false; setSaving(false); }
  };
  const mute = (value: boolean) => {
    mutedRef.current = value; setMuted(value); receiver.current?.mute(value);
  };
  const displayAction = { receiver, updating, saving: setSaving, status: setStatus, release: () => pointer.release() };
  const togglePrivacy = () => changeDesktopDisplay({ ...displayAction,
    allowed: capabilities.privacyScreen === true && capabilities.control !== false,
    message: '正在切换隐私屏，请稍候。', run: current => current.privacy(!privacyScreen) });
  const resolution = { options: capabilities.resolution && capabilities.control !== false ? resolutions : [],
    change: (size: DesktopResolution) => changeDesktopDisplay({ ...displayAction,
      allowed: capabilities.resolution === true && capabilities.control !== false,
      message: '正在切换分辨率，请稍候。', run: current => current.resolution(size) }) };
  const currentClipboard = () => {
    if (!capabilities.clipboard) throw new Error(capabilities.control === undefined
      ? '请更新远程电脑上的应用，启用实体键盘和剪贴板。' : '电脑未允许剪贴板操作，请在电脑的设置中调整。');
    if (!receiver.current) throw new Error('请等待桌面连接后重试。');
    return receiver.current.clipboard;
  };
  const clipboard = {
    read: async (shortcut?: 'copy' | 'cut', progress?: ClipboardProgress) =>
      currentClipboard().read(shortcut, progress),
    write: async (content: ClipboardContent, paste = true, progress?: ClipboardProgress) =>
      currentClipboard().write(content, paste, progress),
  };
  return { stream, status, stats, settings, displays, update, saving, pointer, muted, mute, hasAudio, clipboard, capabilities,
    privacyScreen, togglePrivacy, resolution, frameRendered: () => receiver.current?.frameRendered(stream),
    waitingForPermission: waitingForDesktopPermission(status),
    input: (input: Parameters<DesktopReceiver['input']>[0]) => receiver.current?.input(input),
    retry: () => {
      if (!active || !available.current) return;
      recovery.current?.stop();
      recovery.current = new DesktopRecovery(() => setAttempt(value => value + 1), setStatus, client.permissionStatus);
      setAttempt(value => value + 1);
    } };
}
