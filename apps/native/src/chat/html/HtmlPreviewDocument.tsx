import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { t } from '../../i18n';
import { textMetrics } from '../../theme/text';
import { useThemeColor } from '../../theme/store';
import { HtmlPreparation, type HtmlFileContext, type PreparedHtml } from './HtmlPreparation';

export function HtmlPreviewDocument({ text, context, onError }: {
  text: string; context?: HtmlFileContext; onError: () => void;
}) {
  const color = useThemeColor();
  const [prepared, setPrepared] = useState<PreparedHtml>();
  const [loading, setLoading] = useState(true);
  useEffect(() => { setPrepared(undefined); setLoading(true); }, [text, context?.path, context?.client, context?.threadId]);
  const source = useMemo(() => ({ html: prepared?.html ?? text, baseUrl: 'about:blank' }), [prepared, text]);
  const preparing = Boolean(context && !prepared);
  return <View style={{ flex: 1 }}>
    {preparing && context && <HtmlPreparation text={text} context={context} complete={setPrepared} fail={onError} />}
    {prepared?.failed && <Text accessibilityRole="alert" style={{ ...textMetrics(14, 21), maxWidth: 400,
      padding: 12, color: color('#708078', 'muted') }}>{t('client.filePreview.someHtmlAssetsUnavailable')}</Text>}
    {!preparing && <WebView source={source} style={{ flex: 1 }} incognito
      // The untrusted page has no native message bridge or access to device files.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url.startsWith('about:blank#')}
      javaScriptEnabled domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      geolocationEnabled={false} mediaCapturePermissionGrantType="deny" mediaPlaybackRequiresUserAction
      onLoadEnd={() => setLoading(false)} onError={onError} />}
    {(preparing || loading) && <View style={{ position: 'absolute', inset: 0, alignItems: 'center',
      justifyContent: 'center', gap: 12, backgroundColor: color('#fff', 'surface') }}
      accessibilityLiveRegion="polite" accessibilityRole="progressbar" accessibilityLabel={t('client.chat.loadingFile')}>
      <ActivityIndicator size="large" color={color('#0b8065', 'accent')} />
      <Text style={{ ...textMetrics(14, 21), maxWidth: 400, color: color('#708078', 'muted') }}>
        {t('client.chat.loadingFile')}</Text>
    </View>}
  </View>;
}
