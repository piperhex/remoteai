import { useCallback, useEffect, useRef, useState } from 'react';
import { hasLocalBackend, invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import type { DashboardPage } from '../dashboard/DashboardNavigation';
import { boundedMessages, helpError, messageHistory, MAX_QUESTION_LENGTH, type HelpError,
  type HelpMessage, type HelpStatus, type HelpAvailability, type HelpContent } from './types';
import { useHelpImages } from './useHelpImages';
import { askHelp } from './streaming';

export function useHelpAssistant(options: { open: boolean; page: DashboardPage }) {
  const [status, setStatus] = useState<HelpStatus>();
  const [error, setError] = useState<HelpError>();
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<HelpContent>();
  const [streamed, setStreamed] = useState('');
  const [operating, setOperating] = useState(false);
  const cancelRequest = useRef<() => Promise<void>>();
  const [unread, setUnread] = useState(false);
  const open = useRef(options.open);
  open.current = options.open;
  const observing = options.open || Boolean(pending) || unread;
  const attachments = useHelpImages();
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const statusFlight = useRef(false);
  const refreshAgain = useRef(false);
  const generation = useRef(0);
  const nextId = useRef(0);
  const accountRevision = useRef<number>();
  const mounted = useRef(true);
  const request = useRef<AbortController>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; request.current?.abort(); };
  }, []);
  useEffect(() => { if (options.open) setUnread(false); }, [options.open]);

  const refresh = useCallback(async () => {
    if (statusFlight.current) { refreshAgain.current = true; return; }
    statusFlight.current = true;
    setChecking(true);
    try {
      do {
        refreshAgain.current = false;
        const result: HelpAvailability = hasLocalBackend
          ? await invoke<HelpAvailability>('remote_ai_help_status') : { status: 'installRequired' };
        if (!mounted.current) return;
        if (accountRevision.current !== undefined && accountRevision.current !== result.accountRevision) {
          generation.current++; setMessages([]); setStreamed(''); setUnread(false);
        }
        accountRevision.current = result.accountRevision;
        setStatus(result.status); setError(undefined);
      } while (refreshAgain.current);
    } catch (failure) {
      if (mounted.current) { setStatus(undefined); setError(helpError(failure)); }
    } finally {
      statusFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!options.open) return;
    void refresh();
    const onFocus = () => { if (!busy.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [options.open, refresh]);

  useEffect(() => {
    if (!observing || !hasLocalBackend) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void subscribeGuiEvent('codex-gui-account-changed', () => {
      generation.current++;
      setMessages([]);
      setStreamed(''); setUnread(false);
      setError('accountChanged');
      setStatus(undefined);
      void refresh();
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch(() => { if (!disposed) setError('unavailable'); });
    return () => { disposed = true; stop?.(); };
  }, [observing, refresh]);

  const send = async (question = draft) => {
    question = question.trim();
    const images = attachments.images;
    if (busy.current || attachments.reading || status !== 'ready' || (!question && !images.length)) return;
    if (Array.from(question).length > MAX_QUESTION_LENGTH) { setError('invalidRequest'); return; }
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    const currentGeneration = generation.current;
    setStreamed(''); setUnread(false);
    setError(undefined); setPending({ text: question, images }); setDraft(''); attachments.clear();
    try {
      const answer = await askHelp({
        question, ...(images.length ? { images } : {}), history: messageHistory(messages, images),
        page: options.page, accountRevision: accountRevision.current,
      }, { progress: (text) => {
        if (mounted.current && currentGeneration === generation.current) setStreamed(text);
      }, activity: (active) => { if (mounted.current) setOperating(active); },
      cancelReady: (cancel) => { cancelRequest.current = cancel; } }, controller.signal);
      if (!mounted.current) return;
      if (currentGeneration !== generation.current) {
        setDraft(question); attachments.setImages(images); setError('accountChanged'); return;
      }
      setMessages((current) => boundedMessages([...current,
        { id: nextId.current++, role: 'user' as const, text: question, images },
        { id: nextId.current++, role: 'assistant' as const, ...answer },
      ]));
      setUnread(!open.current);
    } catch (failure) {
      if (!mounted.current) return;
      const problem = helpError(failure);
      setError(problem); setDraft(question); attachments.setImages(images);
      if (problem === 'accountChanged') void refresh();
      if (['installRequired', 'initializeRequired', 'accountRequired'].includes(problem)) {
        setStatus(problem as HelpStatus);
      }
    } finally {
      busy.current = false;
      request.current = undefined;
      cancelRequest.current = undefined;
      if (mounted.current) { setPending(undefined); setStreamed(''); setOperating(false); }
    }
  };

  const clear = () => {
    if (busy.current || attachments.reading) return;
    generation.current++; setMessages([]); setDraft(''); setError(undefined); setUnread(false); attachments.clear();
  };
  const stop = async () => {
    if (!cancelRequest.current) { request.current?.abort(); return; }
    try { await cancelRequest.current(); } catch { if (mounted.current) setError('stopFailed'); }
  };
  return { status, error, messages, draft, setDraft, pending, streamed, unread, checking, refresh, send, clear, attachments,
    operating, stop };
}
