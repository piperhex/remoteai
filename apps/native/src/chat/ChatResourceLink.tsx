import { useThemeColor } from '../theme/store';
import { useContext } from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { ChatFileContext } from './ChatFilePreview';
import { palette, useStyles } from './styles';

export function ChatResourceLink({ uri, name }: { uri: string; name?: string }) {
  const styles = useStyles();
  const color = useThemeColor();
  const openFile = useContext(ChatFileContext);
  const file = parseFileReference(uri);
  const web = /^https?:\/\//i.test(uri);
  if (!web && !(file && openFile)) return <Text selectable style={styles.messageText}>{name || uri}</Text>;
  return <Pressable accessibilityRole="link" onPress={() => {
    if (file && openFile) openFile(file);
    else void Linking.openURL(uri).catch(() => undefined);
  }}><Text style={[styles.messageText, { color: color(palette.green, 'accent'), textDecorationLine: 'underline' }]}>
    {name || uri}</Text></Pressable>;
}
