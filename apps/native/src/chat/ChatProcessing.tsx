import { createThemedStyles } from '../theme/styles';
import { ActivityIndicator, Text, View } from 'react-native';
import { useStyles } from './styles';
import { useLanguage } from '../i18n';
import { useProcessingStatus, type ChatProcessingProps }
  from '../../../../shared/remote-chat/client/useProcessingStatus';

export function ChatProcessing(props: ChatProcessingProps) {
  const styles = useStyles();
  const processingStyles = useProcessingStyles();
  useLanguage();
  const { label } = useProcessingStatus(props);
  return <View style={[styles.historyStatus, processingStyles.row]}>
    <ActivityIndicator size="small" />
    <Text style={[styles.status, processingStyles.label]}>{label}</Text>
  </View>;
}

const useProcessingStyles = createThemedStyles(() => ({
  row: { flexShrink: 0 },
  // Reserve the available width so Android's fallback font can wrap without clipping the final glyphs.
  label: { flex: 1, minWidth: 0, maxWidth: 400 },
}));
