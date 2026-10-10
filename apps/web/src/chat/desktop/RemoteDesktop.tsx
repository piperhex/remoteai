import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clipboard, Grid2X2, Hand, Keyboard, Maximize, Monitor, Mouse, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import type { LocalDesktopClipboard } from '../../../../../shared/remote-desktop/clipboard';
import { useDesktopSession } from '../../../../../shared/remote-desktop/useDesktopSession';
import { DisplaySettings } from './DisplaySettings';
import { DesktopTitlebar } from './DesktopTitlebar';
import { useDesktopWindow, type DesktopWindowState } from './useDesktopWindow';
import { DesktopStats } from './DesktopStats';
import { DesktopMouse } from './MousePad';
import { useTrackpad } from './useTrackpad';
import { useVideoViewport } from './useVideoViewport';
import { useMousePanel } from '../../../../../shared/remote-desktop/useMousePanel';
import { useMouseViewport } from '../../../../../shared/remote-desktop/useMouseViewport';
import { useDesktopZoom } from '../../../../../shared/remote-desktop/useDesktopZoom';
import { useInputViewport } from '../../../../../shared/remote-desktop/useInputViewport';
import { MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE } from '../../../../../shared/remote-desktop/geometry';
import { t } from '../../i18n';
import { usePageVisibility } from './usePageVisibility';
import { useKeyboardViewport } from './useKeyboardViewport';
import { useDesktopPlayback } from './useDesktopPlayback';
import { useHardwarePointer } from './useDesktopMouse';
import { useDesktopClipboard } from './useDesktopClipboard';
import { DesktopClipboardPanel } from './DesktopClipboardPanel';
import { DesktopInputSurface } from './DesktopInputSurface';
import { DesktopKeyboard } from './DesktopKeyboard';
import { useDesktopOrientation } from './useDesktopOrientation';
import { DesktopErrorBoundary } from './DesktopErrorBoundary';
import './desktop.css';

const createPeer = (configuration: RTCConfiguration) => new RTCPeerConnection(configuration);

interface Props {
  client: DesktopClient; active: boolean; close: () => void; localClipboard?: LocalDesktopClipboard;
  connected?: boolean;
  nativeWindow?: boolean;
  windowState?: DesktopWindowState;
}

export function RemoteDesktop(props: Props) {
  return <DesktopErrorBoundary active={props.active} close={props.close}>
    <DesktopViewer {...props} />
  </DesktopErrorBoundary>;
}

function DesktopViewer({ client, active, connected = true, close, localClipboard, nativeWindow = false,
  windowState }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const windowControls = useDesktopWindow(root, active, windowState);
  const shown = active && !windowControls.minimized;
  const visible = usePageVisibility();
  const session = useDesktopSession({ client, active: active && visible, connected, createPeer });
  const viewOnly = session.capabilities.control === false;
  const [display, setDisplay] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const keyboardViewport = useKeyboardViewport(shown && (keyboard || display));
  const [direct, setDirect] = useState(false);
  const [statsVisible, setStatsVisible] = useState(true);
  const hardware = useHardwarePointer();
  const desktopWindow = nativeWindow || hardware;
  const clipboard = useDesktopClipboard({ active: shown && !!session.stream,
    clipboard: session.clipboard, localClipboard });
  const panelVisible = !viewOnly && !hardware && !direct && !display && !keyboard && !clipboard.open;
  const panel = useMousePanel(shown && panelVisible && !!session.stream);
  const video = useRef<HTMLVideoElement>(null);
  const playback = useDesktopPlayback(video, session.stream, session.muted);
  const silent = session.muted || playback.blocked;
  const audioUnavailable = !session.hasAudio || session.stats?.audio === 'unavailable';
  const toggleAudio = () => {
    if (silent) { session.mute(false); playback.enable(); } else session.mute(true);
  };
  useDesktopOrientation(root, shown && !desktopWindow);
  const stage = useRef<HTMLDivElement>(null);
  const measured = useVideoViewport(stage, video, shown);
  const fitted = useInputViewport(measured, keyboard);
  const zoom = useDesktopZoom(fitted, shown && !!session.stream);
  const viewport = useMouseViewport(session.pointer, zoom.viewport,
    panelVisible ? (panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE) : undefined, zoom.modified);
  const trackpad = useTrackpad({ pointer: session.pointer, viewport, direct, panel, id: 'stage', zoom: zoom.gestures });
  const wheel = (delta: number, horizontal = false) => {
    session.pointer.synchronize(); session.input({ kind: 'wheel', delta, ...(horizontal ? { horizontal } : {}) });
  };
  const switchMode = (next: boolean) => { session.pointer.release(); setDirect(next); if (!next) panel.expand(); };
  useEffect(() => {
    if (!shown) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = hardware ? root.current?.querySelector<HTMLTextAreaElement>('.rd-key-capture') : root.current;
    target?.focus({ preventScroll: true });
    return () => { session.pointer.release(); previous?.focus(); };
  }, [shown, hardware, session.pointer]);
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  if (!active) return null;
  return createPortal(<><div ref={root} tabIndex={-1} className="rd-root" style={keyboardViewport}
    hidden={windowControls.minimized}
    role="dialog" aria-modal="true"
    aria-label={t('远程桌面')} onContextMenu={event => event.preventDefault()}>
    {desktopWindow && <DesktopTitlebar displays={session.displays} selected={session.settings.displayId}
      nativeWindow={nativeWindow} controls={windowControls} close={close}
      disabled={session.saving || !session.stream}
      select={displayId => { void session.update({ ...session.settings, displayId }); }} />}
    <div className="rd-workspace">
    <div ref={stage} className="rd-stage">
      <video ref={video} autoPlay playsInline className="rd-video" style={{
        left: viewport.content.x, top: viewport.content.y,
        width: viewport.content.width, height: viewport.content.height }} />
      <DesktopInputSurface key={direct ? 'direct' : 'trackpad'} pointer={session.pointer} viewport={viewport}
        input={session.input} trackpad={trackpad} hardware={hardware} active={!!session.stream && shown}
        clipboard={clipboard} wheel={wheel} />
      {session.stream && session.stats && statsVisible && !keyboard
        && <DesktopStats stats={session.stats} close={() => setStatsVisible(false)} />}
      {session.stream && !hardware && <DesktopMouse pointer={session.pointer} viewport={viewport} panel={panel}
        visible={panelVisible} wheel={wheel}
        horizontal={!!session.capabilities.horizontalScroll} />}
      {session.status && <div className={`rd-status${session.stream ? '' : ' rd-status-empty'}`} role="status">
        <span>{t(session.status)}</span>
        <button disabled={!connected} onClick={session.retry}>
          {t(session.waitingForPermission ? '检查授权' : '重新连接')}</button></div>}
      {windowControls.error && <div className="rd-clipboard-notice" role="alert">{t(windowControls.error)}</div>}
      {display && <DisplaySettings settings={session.settings} displays={session.displays} update={session.update}
        saving={session.saving || !session.stream}
        stats={{ visible: statsVisible, toggle: () => setStatsVisible(!statsVisible) }}
        close={() => setDisplay(false)} />}
      {clipboard.open && <DesktopClipboardPanel clipboard={clipboard} />}
      {!clipboard.open && clipboard.status && <div className="rd-clipboard-notice" role="status">
        {t(clipboard.status)}{clipboard.progress !== undefined && ` ${clipboard.progress}%`}</div>}
      {viewOnly && session.stream && <div className="rd-clipboard-notice" role="status">{t('仅观看')}</div>}
      {!viewOnly && hardware && session.stream && !session.capabilities.keyboard && !clipboard.status
        && <div className="rd-clipboard-notice" role="status">
          {t('请更新远程电脑上的应用，启用实体键盘和剪贴板。')}</div>}
    </div>
    <nav className="rd-toolbar" aria-label={t('远程桌面操作')}>
      {!hardware && <button disabled={viewOnly} aria-label={t(direct ? '切换为鼠标模式' : '切换为触屏模式')} className="rd-mode"
        onClick={() => switchMode(!direct)}>{direct ? <Hand /> : <Mouse />}<span>{t(direct ? '触屏' : '鼠标')}</span></button>}
      <button disabled={viewOnly} aria-pressed={keyboard} onClick={() => {
        setKeyboard(!keyboard); setDisplay(false); clipboard.setOpen(false);
      }}>
        <Keyboard /><span>{t('键盘')}</span></button>
      <button aria-pressed={clipboard.open} onClick={() => {
        clipboard.setOpen(!clipboard.open); setKeyboard(false); setDisplay(false);
      }}><Clipboard /><span>{t('剪贴板')}</span></button>
      <button aria-label={t(audioUnavailable ? '声音暂不可用' : silent ? '开启声音' : '静音')}
        aria-pressed={!silent && !audioUnavailable} disabled={audioUnavailable} onClick={toggleAudio}>
        {silent || audioUnavailable ? <VolumeX /> : <Volume2 />}<span>{t(silent ? '开启声音' : '声音')}</span></button>
      <button disabled={viewOnly} onClick={() => session.input({ kind: 'key', key: 'desktop' })}>
        <Monitor /><span>{t('显示桌面')}</span></button>
      <button disabled={viewOnly} onClick={() => session.input({ kind: 'key', key: 'windows' })}>
        <Grid2X2 /><span>{t('所有窗口')}</span></button>
      <button aria-pressed={display} onClick={() => {
        setDisplay(!display); setKeyboard(false); clipboard.setOpen(false);
      }}>
        <Settings2 /><span>{t('显示')}</span></button>
      {!desktopWindow && document.fullscreenEnabled
        && <button onClick={fullscreen}><Maximize /><span>{t('全屏')}</span></button>}
      {!desktopWindow && <button onClick={close}><X /><span>{t('关闭')}</span></button>}
    </nav>
    </div>
    {keyboard && <DesktopKeyboard input={session.input} close={() => setKeyboard(false)}
      platform={session.capabilities.platform}
      supported={!!session.capabilities.keyboard} />}
  </div>
    {windowControls.minimized && !windowState && <button type="button" className="rd-restore"
      aria-label={t('恢复远程桌面')} onClick={windowControls.restore}>
      <Monitor size={22} /><span>{t('远程桌面')}</span>
    </button>}
  </>, document.body);
}
