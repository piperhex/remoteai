import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Alert } from 'antd';
import { ChatConnection } from '../../../../shared/remote-chat/client/connection';
import { browserTrustStore, trustedHost, trustScope } from '../../../../shared/remote-chat/trustedHost';
import { desktopClient } from '../../../../shared/remote-desktop/protocol';
import { createDesktopPeer } from '../remoteChat/peer';
import { createDesktopNativePath } from '../remoteChat/nativePath';
import { NativeGuiSocket } from '../pages/codexGui/remote/nativeSocket';
import type { GuiCloudIdentity } from '../pages/codexGui/remote/types';
import { localDesktopClipboard } from '../remoteDesktop/localClipboard';
import { guiText } from '../i18n/guiText';
import type { AssistanceInvitation } from './store';
import styles from './assistance.module.less';

const RemoteDesktop = lazy(() => import('../../../web/src/chat/desktop/RemoteDesktop')
  .then(module => ({ default: module.RemoteDesktop })));

export function AssistanceViewer({ invitation, identity, close }: {
  invitation: AssistanceInvitation; identity: GuiCloudIdentity; close: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const connection = useMemo(() => new ChatConnection({
    deviceId: invitation.hostDeviceId, tcpPunch: true, managePolicyMode: false,
    verifyHostKey: trustedHost(browserTrustStore, trustScope(identity.baseUrl, invitation.hostDeviceId)),
    randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
    authorize: async () => ({ baseUrl: identity.baseUrl, accessToken: '' }),
    createSocket: () => new NativeGuiSocket(identity, invitation.id),
    createPeer: createDesktopPeer, createNativePath: createDesktopNativePath,
    mode: mode => { if (mode === 'offline' || mode === 'connecting') setReady(false); },
    ready: () => { setReady(true); setError(''); },
    event: () => {}, error: setError,
  }), [identity.baseUrl, identity.userId, invitation.id, invitation.hostDeviceId]);
  const client = useMemo(() => desktopClient(body => connection.request('request', body),
    connection.reportDiagnostic, connection.openNativeMedia), [connection]);
  useEffect(() => { connection.start(); return () => connection.stop(); }, [connection]);
  return <>
    {error && <Alert className={styles.viewerError} type="error" message={guiText(error)} closable />}
    <Suspense fallback={<div className={styles.status} role="status">{guiText('正在连接对方的电脑…')}</div>}>
      <RemoteDesktop client={client} active connected={ready} close={close}
        nativeWindow localClipboard={localDesktopClipboard} />
    </Suspense>
  </>;
}
