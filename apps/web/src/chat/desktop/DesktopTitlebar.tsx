import type { ComponentProps } from 'react';
import { Maximize, Minimize, Minus, X } from 'lucide-react';
import { DesktopDisplayBar } from './DesktopDisplayBar';
import type { useDesktopWindow } from './useDesktopWindow';
import { t } from '../../i18n';
import './titlebar.css';

interface Props extends ComponentProps<typeof DesktopDisplayBar> {
  controls: ReturnType<typeof useDesktopWindow>;
  close: () => void;
}

export function DesktopTitlebar({ controls, close, ...displays }: Props) {
  const drag = displays.nativeWindow && !controls.fullscreen || undefined;
  return <header className="rd-titlebar" data-tauri-drag-region={drag}>
    <DesktopDisplayBar {...displays} nativeWindow={drag} />
    <div className="rd-titlebar-space" data-tauri-drag-region={drag} />
    <div className="rd-window-controls" role="group" aria-label={t('远程桌面窗口操作')}>
      <button type="button" aria-label={t('最小化')} disabled={controls.busy}
        onClick={() => { void controls.minimize(); }}><Minus size={18} /></button>
      <button type="button" aria-label={t(controls.fullscreen ? '退出全屏' : '全屏')}
        aria-pressed={controls.fullscreen} disabled={controls.busy || !document.fullscreenEnabled}
        onClick={() => { void controls.toggleFullscreen(); }}>
        {controls.fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
      </button>
      <button type="button" className="rd-window-close" aria-label={t('关闭')} onClick={close}>
        <X size={19} />
      </button>
    </div>
  </header>;
}
