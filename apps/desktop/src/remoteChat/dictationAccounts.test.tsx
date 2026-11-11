// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { GUI_ACCOUNTS_EVENT, GUI_ACCOUNT_SELECTION_EVENT } from '../../../../shared/remote-chat/guiAccounts';
import { useDictation } from '../../../../shared/chat/dictation/useDictation';
import { startRecording, type Recording } from '../../../../shared/chat/dictation/recording';

vi.mock('../../../../shared/chat/dictation/recording', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../shared/chat/dictation/recording')>(),
  startRecording: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

let root: Root;
let controller: ChatController;
let events: ConnectionEvents;
let state: ReturnType<typeof useDictation>;
let audio: ReturnType<typeof deferred<Blob>>;
let prepared: ReturnType<typeof deferred<{ sessionId: string }>>;
let transcript: ReturnType<typeof deferred<{ text: string }>>;
let recording: Recording;
const request = vi.fn();
const onText = vi.fn();
const onBusyChange = vi.fn();
const accountListChanged = vi.fn();

function Fixture() {
  state = useDictation({ client: controller.dictation, active: true, onText, onBusyChange });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  audio = deferred<Blob>();
  prepared = deferred<{ sessionId: string }>();
  transcript = deferred<{ text: string }>();
  recording = { result: audio.promise, stop: vi.fn(),
    cancel: vi.fn(() => audio.reject(new DOMException('Cancelled', 'AbortError'))) };
  vi.mocked(startRecording).mockResolvedValue(recording);
  request.mockImplementation(async (_method, body: { action: string }) => {
    if (body.action === 'prepare') return prepared.promise;
    if (body.action === 'transcribe') return transcript.promise;
  });
  controller = new ChatController(value => { events = value; return { request, start() {}, stop() {} }; });
  controller.guiAccounts.subscribe(accountListChanged);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

type Phase = 'preparing' | 'recording' | 'transcribing';
async function reach(phase: Phase) {
  await act(async () => { void state.start(); });
  if (phase !== 'preparing') await act(async () => prepared.resolve({ sessionId: 'voice' }));
  if (phase === 'transcribing') {
    await act(async () => audio.resolve(new Blob(['audio'], { type: 'audio/webm' })));
    await vi.waitFor(() => expect(state.phase).toBe('transcribing'));
  }
  expect(state.phase).toBe(phase);
}

it.each<Phase>(['preparing', 'recording', 'transcribing'])(
  'keeps %s intact on account list and balance refresh notifications', async phase => {
    await reach(phase);
    await act(async () => events.event({ method: GUI_ACCOUNTS_EVENT, params: {} }));
    expect(accountListChanged).toHaveBeenCalledOnce();
    expect(state.phase).toBe(phase);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(recording.cancel).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith('request', expect.objectContaining({ action: 'cancel' }));
    if (phase === 'preparing') await act(async () => prepared.resolve({ sessionId: 'voice' }));
    if (phase !== 'transcribing') {
      await act(async () => audio.resolve(new Blob(['audio'], { type: 'audio/webm' })));
      await vi.waitFor(() => expect(state.phase).toBe('transcribing'));
    }
    await act(async () => transcript.resolve({ text: 'Keep this recording' }));
    expect(onText).toHaveBeenCalledExactlyOnceWith('Keep this recording');
    expect(state.phase).toBe('idle');
  });

it('refreshes Claude defaults from another client without interrupting a Codex recording', async () => {
  await reach('recording');
  await act(async () => events.event({ method: 'claudeAccounts/changed', params: {} }));
  expect(accountListChanged).toHaveBeenCalledOnce();
  expect(state.phase).toBe('recording');
  expect(recording.cancel).not.toHaveBeenCalled();
});

it.each<Phase>(['preparing', 'recording', 'transcribing'])(
  'cancels %s on a real account switch and ignores late results', async phase => {
    await reach(phase);
    await act(async () => events.event({ method: GUI_ACCOUNT_SELECTION_EVENT, params: {} }));
    expect(state.phase).toBe('idle');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    if (phase === 'preparing') await act(async () => prepared.resolve({ sessionId: 'voice' }));
    if (phase === 'recording') expect(recording.cancel).toHaveBeenCalledOnce();
    if (phase === 'transcribing') await act(async () => transcript.resolve({ text: 'Stale recording' }));
    expect(request).toHaveBeenCalledWith('request', expect.objectContaining({ action: 'cancel', sessionId: 'voice' }));
    expect(onText).not.toHaveBeenCalled();
  });
