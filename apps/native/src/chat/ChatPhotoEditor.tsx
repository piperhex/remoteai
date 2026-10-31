import { displayText } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeMode } from '../theme/store';
import { t, useLanguage, getLocale } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { editedImageMessage, imageEditorHtml,
  type ImageEditorOutputLimits } from '../../../../shared/chat/imageEditorHtml';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';
import type { ChatPhoto } from './chatPhotos';

interface Props {
  photo: Pick<ChatPhoto, 'dataUrl'>; save: (dataUrl: string) => void; close: () => void;
  mode?: ConnectionMode; outputLimits?: ImageEditorOutputLimits;
}

export function ChatPhotoEditor({ photo, save, close, mode, outputLimits }: Props) {
  const styles = useStyles();
  const language = useLanguage();
  const themeMode = useThemeMode();
  const initialTheme = useRef(themeMode);
  const webview = useRef<WebView>(null);
  const source = useMemo(() => ({ html: imageEditorHtml(photo.dataUrl, displayText, getLocale(), {
    themeMode: initialTheme.current, mode, outputLimits,
  }) }), [photo.dataUrl, language, mode, outputLimits]);
  const themeScript = `document.documentElement.dataset.theme = ${JSON.stringify(themeMode)}; true;`;
  // Update only the page colors so an appearance change preserves unsaved annotations.
  useEffect(() => { webview.current?.injectJavaScript(themeScript); }, [themeScript]);
  const [error, setError] = useState('');
  const receive = (raw: string) => {
    try {
      if (raw === '{"type":"cancel"}') { close(); return; }
      const dataUrl = editedImageMessage(raw, mode);
      if (!dataUrl) return;
      save(dataUrl);
      close();
    } catch { setError(t("client.mobile.imageNotSavedUseFewerAnnotationsOrPhotosAndTry")); }
  };
  return <Modal visible animationType="slide" onRequestClose={close}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={styles.container}>
      <WebView ref={webview} source={source} style={styles.container} originWhitelist={['about:blank']}
        onLoadEnd={() => webview.current?.injectJavaScript(themeScript)}
        scrollEnabled={false} bounces={false} javaScriptEnabled
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
        onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
        onMessage={({ nativeEvent }) => receive(nativeEvent.data)}
        onError={() => setError(t("client.mobile.couldNotEditTheImageCloseItAndTryAgain"))} />
      {!!error && <View style={styles.notice}>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.close}>
          <Text style={styles.error}>{t("client.mobile.closeEditor")}</Text>
        </Pressable>
      </View>}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  container: { flex: 1, backgroundColor: color('#f1f3f6', 'canvas') },
  notice: { padding: 12, maxWidth: 400, alignSelf: 'center' },
  error: { color: color('#b42318', 'warning'), textAlign: 'center' },
  close: { minHeight: 44, justifyContent: 'center' },
}));
