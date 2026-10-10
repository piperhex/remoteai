import { t, useLanguage } from '../i18n';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useStyles } from './styles';

const AUDIO_SOURCE = /^(https?:\/\/|data:audio\/(?:mp3|mpeg|wav|ogg);base64,)/i;
function attribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Use the system media controls without exposing tool markup or allowing page navigation. */
export function ChatAudio({ source }: { source: string }) {
  const styles = useStyles();
  useLanguage();
  if (!AUDIO_SOURCE.test(source)) return <Text style={styles.subtitle}>{t("此音频暂时无法播放。")}</Text>;
  const html = `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src https: http: data:; `
    + `style-src 'unsafe-inline'">`
    + `<body style="margin:0;background:transparent"><audio aria-label="${attribute(t('工具返回的音频'))}" `
    + `controls preload="none" `
    + `style="width:100%" src="${attribute(source)}"></audio></body>`;
  return <View style={{ height: 64 }} accessibilityLabel={t("工具返回的音频")}>
    <WebView source={{ html }} originWhitelist={['about:blank']} javaScriptEnabled={false}
      domStorageEnabled={false} allowFileAccess={false} mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
      style={{ backgroundColor: 'transparent' }} scrollEnabled={false} />
  </View>;
}
