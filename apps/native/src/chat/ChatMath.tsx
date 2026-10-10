import { createThemedStyles } from '../theme/styles';
import { useThemeMode } from '../theme/store';
import { useContext, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { parseFileReference } from '../../../../shared/chat/fileReference';
import { ChatFileContext } from './ChatFilePreview';
import { MIN_MATH_HEIGHT, mathDocument, mathHeight, type MathTextOptions } from './mathDocument';
import { SelectableChatText } from './SelectableChatText';
import type { CopyAction } from './CopyTextButton';

export function ChatMath({ markup, muted, fontSize, copy, compact = false }: MathTextOptions & {
  markup: string; copy?: CopyAction; compact?: boolean;
}) {
  const styles = useStyles();
  const openFile = useContext(ChatFileContext);
  const theme = useThemeMode();
  const [height, setHeight] = useState(MIN_MATH_HEIGHT);
  const source = useMemo(() => ({ html: mathDocument(markup, { muted, fontSize, theme }),
    baseUrl: 'about:blank' }), [markup, muted, fontSize, theme]);
  return <View style={[styles.container, compact && styles.compact]}>
    <WebView source={source} style={styles.content} containerStyle={{ flex: 0, height }} scrollEnabled={false}
      originWhitelist={['*']} onShouldStartLoadWithRequest={({ url }) => {
        if (url === 'about:blank') return true;
        const file = parseFileReference(url);
        if (file && openFile) openFile(file);
        else if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
        return false;
      }}
      onMessage={({ nativeEvent }) => {
        const next = mathHeight(nativeEvent.data);
        if (next !== null) setHeight(next);
      }}
      javaScriptEnabled domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      textZoom={100} />
    {copy && <SelectableChatText copy={copy} />}
  </View>;
}

const useStyles = createThemedStyles(() => ({
  container: { minWidth: 120, alignSelf: 'stretch', marginVertical: 6 },
  compact: { marginVertical: 0 },
  content: { backgroundColor: 'transparent' },
}));
