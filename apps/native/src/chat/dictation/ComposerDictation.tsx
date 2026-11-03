import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DictationClient } from '../../../../../shared/chat/dictation/client';
import { useDictation } from '../../../../../shared/chat/dictation/useDictation';
import { MAX_RECORDING_SECONDS } from '../../../../../shared/chat/dictation/recording';
import { t, displayError, useLanguage } from '../../i18n';
import { textMetrics } from '../../theme/text';
import { useThemeColor } from '../../theme/store';
import { ComposerActionButton } from '../ComposerActionButton';
import { startNativeRecording } from './recording';

interface Props {
  client: DictationClient; active: boolean; disabled: boolean; visible: boolean; children: ReactNode;
  onText: (text: string) => void; onBusyChange: (busy: boolean) => void;
}

function RecordingTimer({ started }: { started: number }) {
  const color = useThemeColor();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.min(MAX_RECORDING_SECONDS,
      Math.floor((Date.now() - started) / 1000))), 250);
    return () => clearInterval(timer);
  }, [started]);
  return <Text style={[styles.text, { color: color('#66736b', 'muted') }]}>
    {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
  </Text>;
}

export function ComposerDictation(props: Props) {
  useLanguage();
  const color = useThemeColor();
  const state = useDictation({ ...props, record: startNativeRecording });
  const recording = state.phase === 'recording';
  const pending = state.phase === 'preparing' || state.phase === 'transcribing';
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => {
      // Some Android vendors report background while their microphone permission activity is open.
      // The recorder checks foreground again after permission and preparation complete.
      if (value === 'background' && state.phase !== 'preparing') state.cancel();
    });
    return () => subscription.remove();
  }, [state.cancel, state.phase]);
  const start = () => { Keyboard.dismiss(); state.cancel(); void state.start(); };
  const textColor = { color: color('#25332b', 'ink') };
  const status = recording ? t('client.dictation.recording') : state.phase === 'preparing'
    ? t('client.dictation.preparingMicrophone') : t('client.dictation.transcribing.5e9ebc');
  return <>
    {props.visible || pending || recording
      ? <ComposerActionButton action="voice" disabled={props.disabled || pending || recording}
        busy={pending} onPress={start} /> : props.children}
    <Modal visible={state.phase !== 'idle'} transparent animationType="fade" onRequestClose={state.cancel}>
      <View style={styles.overlay}>
        <View style={[styles.panel, { backgroundColor: color('#fff', 'surface'),
          borderColor: color('#dce5df', 'border') }]} accessibilityViewIsModal>
          <Text accessibilityRole={state.phase === 'error' ? 'alert' : 'text'} accessibilityLiveRegion="polite"
            style={[styles.text, textColor]}>{state.phase === 'error'
              ? displayError(state.error ?? 'client.dictation.transcriptionFailedPleaseRetry') : status}</Text>
          {recording && <RecordingTimer started={state.started ?? Date.now()} />}
          {recording && <Text style={[styles.text, { color: color('#66736b', 'muted') }]}>
            {t('client.dictation.clickTheMicrophoneToFinishUpTo2Minutes')}</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={state.cancel} style={styles.action}>
              <Text style={[styles.text, textColor]}>{t('client.dictation.cancelVoiceInput')}</Text>
            </Pressable>
            {state.phase === 'error' && <>
              {state.canRetry && <Pressable accessibilityRole="button" onPress={state.retry} style={styles.action}>
                <Text style={[styles.text, textColor]}>{t('client.dictation.retryTranscription')}</Text>
              </Pressable>}
              <Pressable accessibilityRole="button" onPress={start} style={styles.action}>
                <Text style={[styles.text, textColor]}>{t('client.dictation.recordAgain')}</Text>
              </Pressable>
            </>}
            {(recording || pending) && <ComposerActionButton action="recording" disabled={pending}
              busy={pending} onPress={state.stop} />}
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 24, backgroundColor: '#0005' },
  panel: { width: '100%', maxWidth: 400, borderRadius: 20, borderWidth: 1, padding: 20, gap: 8 },
  text: { ...textMetrics(14, 22), flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  action: { paddingHorizontal: 8, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
});
