// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDictation } from '../../../../../../shared/chat/dictation/useDictation';
import { dictationClient } from './client';
import { startRecording, type Recording } from '../../../../../../shared/chat/dictation/recording';
import { subscribeGuiEvent } from '../../../../../../shared/conversation/webEvents';

vi.mock('./client', () => ({ dictationClient: { prepare: vi.fn(), cancel: vi.fn(), transcribe: vi.fn(),
  subscribeAccountChange: (changed: () => void) => subscribeGuiEvent('codex-gui-account-changed', changed) } }));
vi.mock('../../../../../../shared/chat/dictation/recording', () => ({ startRecording: vi.fn() }));
vi.mock('../../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
let root: Root;
let state: ReturnType<typeof useDictation>;
let recording: Recording;
let audio: ReturnType<typeof deferred<Blob>>;
const onText = vi.fn();
const onBusyChange = vi.fn();
function Fixture({ active = true }: { active?: boolean }) {
  state = useDictation({ client: dictationClient, active, onText, onBusyChange });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  audio = deferred<Blob>();
  recording = { result: audio.promise, stop: vi.fn(),
    cancel: vi.fn(() => audio.reject(new DOMException('Cancelled', 'AbortError'))) };
  vi.mocked(startRecording).mockResolvedValue(recording);
  vi.mocked(dictationClient.prepare).mockResolvedValue({ sessionId: 'session' });
  vi.mocked(dictationClient.cancel).mockResolvedValue();
  vi.mocked(dictationClient.transcribe).mockResolvedValue({ text: '转写内容' });
  vi.mocked(subscribeGuiEvent).mockResolvedValue(vi.fn());
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const start = () => act(async () => { void state.start(); });
const finish = () => act(async () => { audio.resolve(new Blob(['audio'], { type: 'audio/webm' })); });

it('records, blocks sending, and returns text only after transcription completes', async () => {
  const response = deferred<{ text: string }>();
  vi.mocked(dictationClient.transcribe).mockReturnValue(response.promise);
  await start();
  expect(state.phase).toBe('recording');
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  act(() => state.stop());
  expect(recording.stop).toHaveBeenCalledOnce();
  await finish();
  expect(state.phase).toBe('transcribing');
  expect(onText).not.toHaveBeenCalled();
  await act(async () => response.resolve({ text: '完成' }));
  expect(onText).toHaveBeenCalledExactlyOnceWith('完成');
  expect(state.phase).toBe('idle');
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it('retries the same recording after a failed upload without reopening the microphone', async () => {
  vi.mocked(dictationClient.transcribe).mockRejectedValueOnce('网络异常');
  await start();
  await finish();
  expect(state.phase).toBe('error');
  expect(state.canRetry).toBe(true);
  await act(async () => { state.retry(); state.retry(); });
  expect(startRecording).toHaveBeenCalledOnce();
  expect(dictationClient.transcribe).toHaveBeenCalledTimes(2);
  expect(vi.mocked(dictationClient.transcribe).mock.calls[0])
    .toEqual(vi.mocked(dictationClient.transcribe).mock.calls[1]);
  expect(onText).toHaveBeenCalledExactlyOnceWith('转写内容');
});

it('cancels capture on account change and ignores late audio', async () => {
  await start();
  await act(async () => vi.mocked(subscribeGuiEvent).mock.calls[0][1]({}));
  expect(recording.cancel).toHaveBeenCalledOnce();
  expect(dictationClient.cancel).toHaveBeenCalledWith('session');
  expect(dictationClient.transcribe).not.toHaveBeenCalled();
  expect(state.phase).toBe('idle');
});

it('ignores a transcription response after the conversation becomes inactive', async () => {
  const response = deferred<{ text: string }>();
  vi.mocked(dictationClient.transcribe).mockReturnValue(response.promise);
  await start();
  await finish();
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => response.resolve({ text: '不能插入其他对话' }));
  expect(onText).not.toHaveBeenCalled();
  expect(dictationClient.cancel).toHaveBeenCalledWith('session');
  expect(state.phase).toBe('idle');
});

it('cancels a late prepared session without requesting microphone access', async () => {
  const prepared = deferred<{ sessionId: string }>();
  vi.mocked(dictationClient.prepare).mockReturnValue(prepared.promise);
  await start();
  act(() => state.cancel());
  await act(async () => prepared.resolve({ sessionId: 'late' }));
  expect(startRecording).not.toHaveBeenCalled();
  expect(dictationClient.cancel).toHaveBeenCalledWith('late');
});

it('shows account validation failures before requesting microphone access', async () => {
  vi.mocked(dictationClient.prepare).mockRejectedValue('请先切换到 ChatGPT 账号，再使用语音输入。');
  await start();
  expect(state.phase).toBe('error');
  expect(state.canRetry).toBeUndefined();
  expect(startRecording).not.toHaveBeenCalled();
});
