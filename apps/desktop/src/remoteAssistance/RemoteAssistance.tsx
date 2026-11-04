import { displayText, displayError } from '../../../../shared/localization/uiText';
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { Alert, Button, Input, Modal } from 'antd';
import { Handshake } from 'lucide-react';
import type { CloudAuthState } from '../types';
import { uiText } from "../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../shared/localization/useGuiLanguage';
import { assistanceStore as store, liveInvitation, type AssistanceInvitation } from './store';
import styles from './assistance.module.less';

const POLL_INTERVAL_MS = 3_000;
const AssistanceViewer = lazy(() => import('./AssistanceViewer')
  .then(module => ({ default: module.AssistanceViewer })));
const STATE_LABELS = {
  pending: "client.remoteAssistance.requestingAssistance", accepted: "client.remoteAssistance.remoteAssistanceActive", declined: "client.remoteAssistance.invitationDeclined", ended: "client.remoteAssistance.assistanceEnded", expired: "client.remoteAssistance.invitationExpired",
} as const;

export function RemoteAssistance({ auth, onLogin }: { auth: CloudAuthState; onLogin: () => void }) {
  useGuiLanguage();
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const { email } = state;
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
  const invite = async () => { if (await store.inviteSelected()) store.setEmail(''); };
  return <>
    {(active || accepted) && !viewer && <div className={styles.status} role="status">
      <Handshake size={16} aria-hidden="true" />
      <span>{active ? displayText(STATE_LABELS[active.state]) : uiText("client.remoteAssistance.remoteAssistanceActive")}</span>
      {active && <span className={styles.email}>{active.helperEmail}</span>}
      {accepted && <Button size="small" onClick={() => store.view(accepted.id)}>{uiText("client.remoteDesktop.openRemoteDesktop")}</Button>}
      <Button size="small" danger disabled={state.busy} onClick={() => end(active ?? accepted!)}>
        {uiText(active?.state === 'pending' ? "client.remoteAssistance.cancelInvitation" : "client.remoteAssistance.endAssistance")}
      </Button>
      {state.error && <span className={styles.error}>{displayError(state.error)}</span>}
    </div>}
    <Modal title={uiText("client.remoteAssistance.remoteAssistance")} open={state.dialog} onCancel={store.dismiss}
      footer={null} width={440} styles={{ body: { maxWidth: 400 } }}>
      <div className={styles.content}>
        <p>{uiText("client.remoteAssistance.inviteSomeoneToViewAndControlThisComputerYouCan")}</p>
        {state.error && <Alert type="error" message={displayError(state.error)} showIcon />}
        {!state.authenticated ? <Button type="primary" onClick={() => { store.dismiss(); onLogin(); }}>
          {uiText("client.remoteAssistance.signInToContinue")}
        </Button> : <>
          {state.recipient ? <p>
            {uiText('client.lounge.assistance.recipient', { email: state.recipient.account })}
          </p> : <>
            <label htmlFor="assistance-email">{uiText("client.remoteAssistance.theirSignInEmail")}</label>
            <Input id="assistance-email" type="email" autoFocus value={email} maxLength={254}
              placeholder="name@example.com" disabled={state.busy || !!active}
              onChange={event => store.setEmail(event.target.value)}
              onPressEnter={() => { if (!active) void invite(); }} />
          </>}
          <p className={styles.hint}>{uiText("client.remoteAssistance.askThemToSignInToRemoteAiOnTheir")}</p>
          <Button type="primary" loading={state.busy} disabled={!state.recipient && !email.trim() || !!active}
            onClick={() => void invite()}>
            {uiText("client.remoteAssistance.sendInvitation")}
          </Button>
          {outgoing.slice(-3).reverse().map(request => <div className={styles.request} key={request.id}>
            <span>{request.helperEmail}</span><span>{displayText(STATE_LABELS[request.state])}</span>
            {liveInvitation(request) && <Button size="small" danger disabled={state.busy} onClick={() => end(request)}>
              {uiText(request.state === 'pending' ? "client.remoteAssistance.cancelInvitation" : "client.remoteAssistance.endAssistance")}
            </Button>}
          </div>)}
        </>}
      </div>
    </Modal>
    <Modal title={uiText("client.remoteAssistance.remoteAssistanceInvitation")} open={!!incoming && !viewer} width={440}
      styles={{ body: { maxWidth: 400 } }} closable={false} maskClosable={false} keyboard={false}
      footer={incoming && <>
        <Button disabled={state.busy} onClick={() => void store.respond(incoming.id, 'decline')}>
          {uiText("client.chat.deny")}
        </Button>
        <Button type="primary" loading={state.busy} disabled={!!accepted}
          onClick={() => void store.respond(incoming.id, 'accept')}>{uiText("client.remoteAssistance.acceptAndConnect")}</Button>
      </>}>
      {incoming && <div className={styles.content}>
        <strong>{incoming.hostEmail}</strong>
        <p>{uiText("client.remoteAssistance.wouldLikeYouToControlThisComputerAndHelpResolve")}</p>
        <span>{incoming.hostName}</span>
        <p className={styles.hint}>{uiText("client.remoteAssistance.acceptToOpenTheirDesktopEitherPersonCanEndAssistance")}</p>
        {state.error && <Alert type="error" message={displayError(state.error)} showIcon />}
      </div>}
    </Modal>
    {viewer && state.identity && <Suspense fallback={null}>
      <AssistanceViewer key={viewer.id} invitation={viewer} identity={state.identity} close={() => end(viewer)} />
    </Suspense>}
  </>;
}
