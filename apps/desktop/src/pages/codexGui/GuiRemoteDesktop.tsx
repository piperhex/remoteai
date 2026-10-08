import { lazy, Suspense, useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { Monitor } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import type { DesktopClient } from '../../../../../shared/remote-desktop/protocol';
import { guiText } from '../../i18n/guiText';
import { localDesktopClipboard } from '../../remoteDesktop/localClipboard';
import styles from './GuiRemoteDesktop.module.less';

const RemoteDesktop = lazy(() => import('../../../../web/src/chat/desktop/RemoteDesktop')
  .then(module => ({ default: module.RemoteDesktop })));

export function GuiRemoteDesktop({ client, active, connected }: {
  client: DesktopClient; active: boolean; connected: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => { if (!active) { setOpened(false); setMinimized(false); } }, [active]);
  const background = opened && minimized && active && connected;
  const label = guiText(background ? '恢复远程桌面' : '打开远程桌面');
  const tooltip = guiText(background ? '远程桌面正在后台运行，点击恢复' : '打开远程桌面');
  const open = () => { setMinimized(false); setOpened(true); };
  const close = () => { setOpened(false); setMinimized(false); };
  return <>
    <Tooltip title={tooltip} styles={{ root: { maxWidth: 400 } }}>
      <button type="button" className={styles.launcher} disabled={!active || !connected}
        aria-label={label} aria-expanded={opened && !minimized} onClick={open}>
        <Monitor size={14} aria-hidden="true" /><span>{guiText('远程桌面')}</span>
        {background && <span className={styles.status} role="status" aria-label={guiText('正在后台运行')} />}
      </button>
    </Tooltip>
    <Suspense fallback={null}>
      {opened && <RemoteDesktop client={client} active={active && connected} close={close}
        windowState={{ minimized, setMinimized }} nativeWindow={isTauri()}
        localClipboard={isTauri() ? localDesktopClipboard : undefined} />}
    </Suspense>
  </>;
}
