import { displayText as uiText } from '../../localization/messages';
import { remoteErrorText as displayError } from '../../localization/errors';
import type { DictationClient } from './client';
import { useEffect, useState } from 'react';
import { Popover, Tooltip } from 'antd';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { useDictation } from './useDictation';
import { MAX_RECORDING_SECONDS } from './recording';
import styles from './ComposerDictation.module.less';

const LABELS = {
  idle: "client.dictation.voiceInput", error: "client.dictation.voiceInput",
  recording: "client.dictation.stopRecordingAndTranscribe",
  preparing: "client.dictation.preparingMicrophone", transcribing: "client.dictation.transcribing",
};

function RecordingTimer({ started }: { started: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.min(MAX_RECORDING_SECONDS,
      Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [started]);
  return <span className={styles.timer}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

export function ComposerDictation(props: {
  client: DictationClient; active: boolean; disabled: boolean;
  buttonClassName?: string;
  onText: (text: string) => void; onBusyChange: (busy: boolean) => void;
}) {
  const state = useDictation(props);
  const recording = state.phase === 'recording';
  const pending = state.phase === 'preparing' || state.phase === 'transcribing';
  const label = uiText(LABELS[state.phase]);
  const reset = () => { state.cancel(); };
  const panel = <div className={styles.panel} role={state.phase === 'error' ? 'alert' : 'status'}>
      <div className={styles.status}>
        {recording && <><span className={styles.dot} /><span>{uiText("client.dictation.recording")}</span>
          <RecordingTimer started={state.started ?? Date.now()} /></>}
        {state.phase === 'preparing' && <span>{uiText("client.dictation.preparingMicrophone")}</span>}
        {state.phase === 'transcribing' && <span>{uiText("client.dictation.transcribing.5e9ebc")}</span>}
        {state.phase === 'error' && <span>
          {displayError(state.error ?? 'client.dictation.transcriptionFailedPleaseRetry')}</span>}
        <button className={styles.close} type="button" aria-label={uiText("client.dictation.cancelVoiceInput")} onClick={reset}>
          <X size={15} />
        </button>
      </div>
      {recording && <div className={styles.hint}>{uiText("client.dictation.clickTheMicrophoneToFinishUpTo2Minutes")}</div>}
      {state.phase === 'error' && <div className={styles.actions}>
        {state.canRetry && <button type="button" onClick={state.retry}>{uiText("client.dictation.retryTranscription")}</button>}
        <button type="button" onClick={() => { reset(); void state.start(); }}>{uiText("client.dictation.recordAgain")}</button>
      </div>}
    </div>;
  return <Popover open={state.phase !== 'idle'} content={panel} placement="topRight" arrow={false}
    styles={{ root: { maxWidth: 400 }, body: { padding: 0, background: 'transparent', boxShadow: 'none' } }}>
    <div className={styles.wrap}>
      <Tooltip title={label} open={state.phase === 'idle' ? undefined : false}
        styles={{ root: { maxWidth: 400 } }}>
        <button type="button" className={props.buttonClassName ?? styles.microphone} aria-label={label}
          aria-pressed={recording} disabled={(props.disabled && !recording) || pending}
          onClick={() => { if (recording) state.stop(); else { reset(); void state.start(); } }}>
          {pending ? <LoaderCircle size={19} className={styles.spinner} />
            : recording ? <Square size={14} fill="currentColor" /> : <Mic size={19} strokeWidth={1.7} />}
        </button>
      </Tooltip>
    </div>
  </Popover>;
}
