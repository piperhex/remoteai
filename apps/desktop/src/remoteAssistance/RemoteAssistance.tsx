import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Modal } from 'antd';
import { Handshake } from 'lucide-react';
import type { CloudAuthState } from '../types';
import { guiText } from '../i18n/guiText';
import { useGuiLanguage } from '../i18n/useGuiLanguage';
import { assistanceStore as store, liveInvitation, type AssistanceInvitation } from './store';
import styles from './assistance.module.less';

const POLL_INTERVAL_MS = 3_000;
const AssistanceViewer = lazy(() => import('./AssistanceViewer')
  .then(module => ({ default: module.AssistanceViewer })));
const STATE_LABELS = {
  pending: '正在请求', accepted: '远程协助中', declined: '对方已拒绝', ended: '协助已结束', expired: '邀请已过期',
} as const;

export function RemoteAssistance({ auth, onLogin }: { auth: CloudAuthState; onLogin: () => void }) {
  useGuiLanguage();
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const [email, setEmail] = useState('');
  useEffect(() => {
    store.reset(auth.authenticated);
    if (!auth.authenticated) return;
    void store.refresh();
    const timer = setInterval(() => { void store.refresh(); }, POLL_INTERVAL_MS);
    return () => { clearInterval(timer); store.reset(false); };
  }, [auth.authenticated, auth.baseUrl, auth.userId]);
  const outgoing = state.requests.filter(request => request.hostDeviceId === state.currentDeviceId);
  const active = outgoing.find(liveInvitation);
  const incoming = state.requests.find(request => request.hostDeviceId !== state.currentDeviceId
    && request.state === 'pending' && liveInvitation(request));
  const accepted = state.requests.find(request => request.helperDeviceId === state.currentDeviceId
    && request.state === 'accepted' && liveInvitation(request));
  const viewer = accepted?.id === state.viewerId ? accepted : undefined;
  const end = (request: AssistanceInvitation) => { void store.respond(request.id, 'end'); };
  const invite = async () => { if (await store.invite(email)) setEmail(''); };
  return <>
    {(active || accepted) && !viewer && <div className={styles.status} role="status">
      <Handshake size={16} aria-hidden="true" />
      <span>{active ? guiText(STATE_LABELS[active.state]) : guiText('远程协助中')}</span>
      {active && <span className={styles.email}>{active.helperEmail}</span>}
      {accepted && <Button size="small" onClick={() => store.view(accepted.id)}>{guiText('打开远程桌面')}</Button>}
      <Button size="small" danger disabled={state.busy} onClick={() => end(active ?? accepted!)}>
        {guiText(active?.state === 'pending' ? '取消邀请' : '结束协助')}
      </Button>
      {state.error && <span className={styles.error}>{guiText(state.error)}</span>}
    </div>}
    <Modal title={guiText('远程协助')} open={state.dialog} onCancel={store.dismiss}
      footer={null} width={440} styles={{ body: { maxWidth: 400 } }}>
      <div className={styles.content}>
        <p>{guiText('邀请对方查看并操作本机。你可以随时结束协助。')}</p>
        {state.error && <Alert type="error" message={guiText(state.error)} showIcon />}
        {!state.authenticated ? <Button type="primary" onClick={() => { store.dismiss(); onLogin(); }}>
          {guiText('登录后使用')}
        </Button> : <>
          <label htmlFor="assistance-email">{guiText('对方的登录邮箱')}</label>
          <Input id="assistance-email" type="email" autoFocus value={email} maxLength={254}
            placeholder="name@example.com" disabled={state.busy || !!active}
            onChange={event => setEmail(event.target.value)} onPressEnter={() => { if (!active) void invite(); }} />
          <p className={styles.hint}>{guiText('请对方在电脑上登录 Remote AI。邀请在 5 分钟内有效。')}</p>
          <Button type="primary" loading={state.busy} disabled={!email.trim() || !!active}
            onClick={() => void invite()}>
            {guiText('发送邀请')}
          </Button>
          {outgoing.slice(-3).reverse().map(request => <div className={styles.request} key={request.id}>
            <span>{request.helperEmail}</span><span>{guiText(STATE_LABELS[request.state])}</span>
            {liveInvitation(request) && <Button size="small" danger disabled={state.busy} onClick={() => end(request)}>
              {guiText(request.state === 'pending' ? '取消邀请' : '结束协助')}
            </Button>}
          </div>)}
        </>}
      </div>
    </Modal>
    <Modal title={guiText('收到远程协助邀请')} open={!!incoming && !viewer} width={440}
      styles={{ body: { maxWidth: 400 } }} closable={false} maskClosable={false} keyboard={false}
      footer={incoming && <>
        <Button disabled={state.busy} onClick={() => void store.respond(incoming.id, 'decline')}>
          {guiText('拒绝')}
        </Button>
        <Button type="primary" loading={state.busy} disabled={!!accepted}
          onClick={() => void store.respond(incoming.id, 'accept')}>{guiText('接受并连接')}</Button>
      </>}>
      {incoming && <div className={styles.content}>
        <strong>{incoming.hostEmail}</strong>
        <p>{guiText('希望你远程控制这台电脑，帮助解决问题。')}</p>
        <span>{incoming.hostName}</span>
        <p className={styles.hint}>{guiText('接受后将打开对方的桌面。双方都可以随时结束协助。')}</p>
        {state.error && <Alert type="error" message={guiText(state.error)} showIcon />}
      </div>}
    </Modal>
    {viewer && state.identity && <Suspense fallback={null}>
      <AssistanceViewer key={viewer.id} invitation={viewer} identity={state.identity} close={() => end(viewer)} />
    </Suspense>}
  </>;
}
