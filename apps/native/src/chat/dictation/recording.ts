import { AudioModule, RecordingPresets, setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { deleteAsync } from 'expo-file-system';
import { AppState, Platform } from 'react-native';
import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS, type Recording } from '../../../../../shared/chat/dictation/recording';

const RECORDING_FAILED = 'client.dictation.recordingStoppedUnexpectedlyCheckYourMicrophoneAndRetry';
const PERMISSION_RESUME_TIMEOUT_MS = 2_000;
// A cancelled recording must release the audio session before a replacement acquires it.
let released: Promise<void> = Promise.resolve();

async function acquire() {
  const previous = released;
  let unlock!: () => void;
  released = new Promise<void>(resolve => { unlock = resolve; });
  await previous;
  return unlock;
}

async function release(recorder: AudioRecorder) {
  const uri = recorder.uri;
  recorder.release();
  await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  // Cache cleanup is best effort; neither cleanup failure should hide the recording result.
  if (uri) await deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

function waitForForeground(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error(RECORDING_FAILED));
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (resumed: boolean) => {
      clearTimeout(timer); subscription.remove(); signal.removeEventListener('abort', cancel);
      if (resumed) resolve(); else reject(new Error(RECORDING_FAILED));
    };
    const cancel = () => finish(false);
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') finish(true); });
    const timer = setTimeout(cancel, PERMISSION_RESUME_TIMEOUT_MS);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function readAudio(recorder: AudioRecorder): Promise<Blob> {
  if (!recorder.uri) throw new Error('client.dictation.noAudioWasRecordedPleaseTryAgain');
  const audio = await (await fetch(recorder.uri)).blob();
  if (!audio.size) throw new Error('client.dictation.noAudioWasRecordedPleaseTryAgain');
  if (audio.size > MAX_AUDIO_BYTES) throw new Error('client.dictation.pleaseRecordAShorterAudioClipAndTryAgain');
  return new Blob([audio], { type: 'audio/mp4' });
}

function capture(recorder: AudioRecorder, signal: AbortSignal, unlock: () => void): Recording {
  let finishing = false;
  let cancelled = false;
  let resolve!: (audio: Blob) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<Blob>((done, fail) => { resolve = done; reject = fail; });
  void result.catch(() => undefined);
  const finish = async (options: { failed?: boolean; stopped?: boolean } = {}) => {
    if (finishing) return;
    finishing = true;
    clearTimeout(timer); subscription.remove(); signal.removeEventListener('abort', cancel);
    try {
      if (!options.stopped) await recorder.stop();
      if (cancelled || options.failed) throw new Error(RECORDING_FAILED);
      resolve(await readAudio(recorder));
    } catch { reject(new Error(RECORDING_FAILED)); }
    finally { try { await release(recorder); } finally { unlock(); } }
  };
  const stop = () => { void finish(); };
  const cancel = () => { cancelled = true; stop(); };
  const subscription = recorder.addListener('recordingStatusUpdate', status => {
    if (!finishing && (status.hasError || status.isFinished)) {
      void finish({ failed: status.hasError, stopped: true });
    }
  });
  const timer = setTimeout(stop, MAX_RECORDING_SECONDS * 1000);
  signal.addEventListener('abort', cancel, { once: true });
  try { recorder.record(); }
  catch (error) {
    clearTimeout(timer); subscription.remove(); signal.removeEventListener('abort', cancel);
    throw error;
  }
  return { result, stop, cancel };
}

/** Capture on the phone; the shared dictation client sends it to the selected computer. */
export async function startNativeRecording(signal: AbortSignal): Promise<Recording> {
  const unlock = await acquire();
  let recorder: AudioRecorder | undefined;
  try {
    if (signal.aborted) throw new Error(RECORDING_FAILED);
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('client.dictation.allowMicrophoneAccessThenTryAgain');
    if (signal.aborted) throw new Error(RECORDING_FAILED);
    const preset = RecordingPresets.HIGH_QUALITY;
    recorder = new AudioModule.AudioRecorder({ ...preset,
      ...(Platform.OS === 'android' ? preset.android : preset.ios) });
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
    if (signal.aborted) throw new Error(RECORDING_FAILED);
    await recorder.prepareToRecordAsync();
    await waitForForeground(signal);
    return capture(recorder, signal, unlock);
  } catch (error) {
    try { if (recorder) await release(recorder); } finally { unlock(); }
    if (error instanceof Error && error.message.startsWith('client.dictation.')) throw error;
    throw new Error('client.dictation.theMicrophoneIsUnavailableCloseOtherAppsUsingItAnd');
  }
}
