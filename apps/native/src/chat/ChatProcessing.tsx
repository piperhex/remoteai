import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { styles } from './styles';
import { useLanguage } from '../i18n';
import { useProcessingStatus, type ChatProcessingProps }
  from '../../../../shared/remote-chat/client/useProcessingStatus';

export function ChatProcessing(props: ChatProcessingProps) {
  useLanguage();
  const { label } = useProcessingStatus(props);
  return <View style={[styles.historyStatus, processingStyles.row]}>
    <ActivityIndicator size="small" />
    <Text style={[styles.status, processingStyles.label]}>{label}</Text>
  </View>;
}

const processingStyles = StyleSheet.create({
  row: { flexShrink: 0 },
  // Reserve the available width so Android's fallback font can wrap without clipping the final glyphs.
  label: { flex: 1, minWidth: 0, maxWidth: 400 },
});
