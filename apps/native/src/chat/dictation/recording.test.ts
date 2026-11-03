import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startNativeRecording } from './recording';
import { recordingError } from '../../../../../shared/chat/dictation/errors';

const audio = vi.hoisted(() => ({
  permission: vi.fn(), mode: vi.fn(), prepare: vi.fn(), stop: vi.fn(), record: vi.fn(), release: vi.fn(),
  remove: vi.fn(), delete: vi.fn(), listener: undefined as undefined | ((status: { hasError: boolean; isFinished: boolean }) => void),
}));
const appState = vi.hoisted(() => ({ currentState: 'active', addEventListener: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: appState }));
vi.mock('expo-file-system', () => ({ deleteAsync: audio.delete }));
vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', android: { outputFormat: 'mpeg4', audioEncoder: 'aac' } } },
  setAudioModeAsync: audio.mode,
  AudioModule: { requestRecordingPermissionsAsync: audio.permission, AudioRecorder: class {
    uri = 'file:///cache/recording.m4a';
    prepareToRecordAsync = audio.prepare;
    stop = audio.stop;
    record = audio.record;
    release = audio.release;
    addListener(_name: string, listener: typeof audio.listener) { audio.listener = listener; return { remove: audio.remove }; }
  } },
}));

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  appState.currentState = 'active';
  appState.addEventListener.mockReturnValue({ remove: vi.fn() });
  audio.permission.mockResolvedValue({ granted: true });
  audio.mode.mockResolvedValue(undefined); audio.prepare.mockResolvedValue(undefined);
  audio.stop.mockResolvedValue(undefined); audio.delete.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['recorded audio']) }));
});
afterEach(async () => { await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('records on the phone, returns MP4 audio, and removes the cached file', async () => {
  const recording = await startNativeRecording(new AbortController().signal);
  expect(audio.record).toHaveBeenCalledOnce();
  recording.stop(); recording.stop();
  const blob = await recording.result;
  await vi.runAllTimersAsync();
  expect(blob.type).toBe('audio/mp4');
  expect(await blob.text()).toBe('recorded audio');
  expect(audio.stop).toHaveBeenCalledOnce();
  expect(audio.release).toHaveBeenCalledOnce();
  expect(audio.delete).toHaveBeenCalledWith('file:///cache/recording.m4a', { idempotent: true });
});

it('does not acquire the microphone when permission is denied', async () => {
  audio.permission.mockResolvedValue({ granted: false });
  await expect(startNativeRecording(new AbortController().signal)).rejects
    .toThrow('client.dictation.allowMicrophoneAccessThenTryAgain');
  expect(audio.prepare).not.toHaveBeenCalled();
});

it('cancels a permission request without starting a late recording', async () => {
  const controller = new AbortController();
  audio.permission.mockImplementation(async () => { controller.abort(); return { granted: true }; });
  await expect(startNativeRecording(controller.signal)).rejects.toThrow();
  expect(audio.record).not.toHaveBeenCalled();
});

it('waits for cancelled preparation to release the microphone before starting again', async () => {
  let complete!: () => void;
  audio.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const controller = new AbortController();
  const first = startNativeRecording(controller.signal);
  const failure = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(audio.prepare).toHaveBeenCalledOnce());
  controller.abort();
  const replacement = startNativeRecording(new AbortController().signal);
  await Promise.resolve();
  expect(audio.permission).toHaveBeenCalledOnce();
  complete(); await failure;
  const recording = await replacement;
  expect(audio.permission).toHaveBeenCalledTimes(2);
  expect(audio.record).toHaveBeenCalledOnce();
  recording.cancel();
  await expect(recording.result).rejects.toThrow();
});

it('stops and discards audio on cancellation, including repeated cleanup', async () => {
  const controller = new AbortController();
  const recording = await startNativeRecording(controller.signal);
  controller.abort(); recording.cancel();
  await expect(recording.result).rejects.toThrow();
  await vi.runAllTimersAsync();
  expect(audio.stop).toHaveBeenCalledOnce();
  expect(audio.release).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it('finishes automatically at the shared two-minute limit', async () => {
  const recording = await startNativeRecording(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(120_000);
  await expect(recording.result).resolves.toMatchObject({ type: 'audio/mp4' });
  expect(audio.stop).toHaveBeenCalledOnce();
});

it('waits for the permission activity to return to the app before capturing audio', async () => {
  appState.currentState = 'background';
  const pending = startNativeRecording(new AbortController().signal);
  await vi.waitFor(() => expect(appState.addEventListener).toHaveBeenCalledOnce());
  expect(audio.record).not.toHaveBeenCalled();
  appState.currentState = 'active';
  appState.addEventListener.mock.calls[0][1]('active');
  const recording = await pending;
  expect(audio.record).toHaveBeenCalledOnce();
  recording.cancel(); await expect(recording.result).rejects.toThrow();
});

it('never starts recording if the user leaves the app during preparation', async () => {
  appState.currentState = 'background';
  const pending = startNativeRecording(new AbortController().signal);
  const failure = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(appState.addEventListener).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(2_000);
  await failure;
  expect(audio.record).not.toHaveBeenCalled();
  expect(audio.release).toHaveBeenCalledOnce();
});

it('reports native interruptions without leaking internal paths', async () => {
  const recording = await startNativeRecording(new AbortController().signal);
  audio.listener?.({ hasError: true, isFinished: true });
  await expect(recording.result).rejects.toThrow('client.dictation.recordingStoppedUnexpectedlyCheckYourMicrophoneAndRetry');
  await vi.runAllTimersAsync();
  expect(audio.release).toHaveBeenCalledOnce();
});

it('formats native errors even when DOMException does not exist', () => {
  vi.stubGlobal('DOMException', undefined);
  expect(recordingError(new Error('client.dictation.allowMicrophoneAccessThenTryAgain')))
    .toBe('client.dictation.allowMicrophoneAccessThenTryAgain');
});
