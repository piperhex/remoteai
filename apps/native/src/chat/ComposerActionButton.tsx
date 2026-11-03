import { displayText } from '../i18n/index';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { COMPOSER_ACTION_LABELS, type ComposerAction } from '../../../../shared/remote-chat/composerAction';
import { palette, useStyles } from './styles';
import { useLanguage } from '../i18n';
import { Feather } from '@expo/vector-icons';

interface Props {
  action: ComposerAction | 'voice' | 'recording'; disabled: boolean; busy: boolean; onPress: () => void;
}

// The green button stays the same in both themes, so its foreground must stay white too.
const ICON_COLOR = '#fff';

export function ComposerActionButton({ action, disabled, busy, onPress }: Props) {
  const styles = useStyles();
  useLanguage();
  const label = action === 'voice' ? 'client.dictation.voiceInput'
    : action === 'recording' ? 'client.dictation.stopRecordingAndTranscribe' : COMPOSER_ACTION_LABELS[action];
  return <Pressable accessibilityRole="button" accessibilityLabel={displayText(label)}
    accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress}
    style={[buttonStyles.button, disabled && styles.disabled]}>
    {busy ? <ActivityIndicator color={ICON_COLOR} /> : <View importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden style={buttonStyles.icon}>
      {action === 'pause' && <View style={buttonStyles.pause}>
        <View style={buttonStyles.bar} /><View style={buttonStyles.bar} />
      </View>}
      {action === 'continue' && <View style={buttonStyles.play} />}
      {action === 'voice' && <Feather name="mic" size={21} color={ICON_COLOR} />}
      {action === 'recording' && <View style={buttonStyles.stop} />}
      {action === 'send' && <><View style={buttonStyles.arrowHead} /><View style={buttonStyles.arrowStem} /></>}
    </View>}
  </Pressable>;
}

const buttonStyles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.green,
    alignItems: 'center', justifyContent: 'center' },
  icon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pause: { flexDirection: 'row', gap: 5 },
  stop: { width: 14, height: 14, borderRadius: 2, backgroundColor: ICON_COLOR },
  bar: { width: 4, height: 16, borderRadius: 1, backgroundColor: ICON_COLOR },
  play: { marginLeft: 3, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: ICON_COLOR },
  arrowHead: { position: 'absolute', top: 3, width: 11, height: 11, borderTopWidth: 2,
    borderLeftWidth: 2, borderColor: ICON_COLOR, transform: [{ rotate: '45deg' }] },
  arrowStem: { position: 'absolute', top: 3, width: 2, height: 16, backgroundColor: ICON_COLOR },
});
