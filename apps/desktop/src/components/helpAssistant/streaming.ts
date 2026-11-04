import { invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import type { DashboardPage } from '../dashboard/DashboardNavigation';
import type { HelpAnswer, HelpContent, HelpMessage } from './types';

interface HelpRequest {
  question: string;
  images?: string[];
  history: Pick<HelpMessage, 'role' | 'text' | 'images'>[];
  page: DashboardPage;
  accountRevision?: number;
}

interface HelpProgress extends HelpContent { requestId: string }
interface HelpCallbacks {
  progress: (text: string) => void;
  activity: (active: boolean) => void;
  cancelReady: (cancel: () => Promise<void>) => void;
}

export async function askHelp(request: HelpRequest, callbacks: HelpCallbacks, signal: AbortSignal) {
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
  const unsubscribe = await subscribeGuiEvent<HelpProgress>('remote-ai-help-progress', (progress) => {
    if (progress.requestId === requestId && typeof progress.text === 'string') callbacks.progress(progress.text);
  });
  let unsubscribeActivity: (() => void) | undefined;
  try {
    unsubscribeActivity = await subscribeGuiEvent<{ requestId: string; activity: string | null }>(
      'remote-ai-help-activity', (event) => {
        if (event.requestId === requestId) callbacks.activity(event.activity === 'computer');
      });
  } catch (error) { unsubscribe(); throw error; }
  let subscribed = true;
  const stop = () => { if (subscribed) { subscribed = false; unsubscribe(); unsubscribeActivity?.(); } };
  if (signal.aborted) { stop(); throw new Error('cancelled'); }
  const cancel = () => invoke<void>('remote_ai_help_cancel', { requestId });
  const abort = () => {
    stop();
    void cancel().catch(() => console.warn('Could not stop the help assistant after its view closed.'));
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const answer = invoke<HelpAnswer>('remote_ai_help_ask', { request: { ...request, requestId } });
    callbacks.cancelReady(cancel);
    return await answer;
  } finally {
    signal.removeEventListener('abort', abort);
    stop();
  }
}
