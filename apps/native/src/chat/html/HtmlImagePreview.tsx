import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useImageViewer } from '../../../../../shared/chat/useImageViewer';
import type { PreviewImageLoader } from '../../../../../shared/remote-chat/previewProgress';
import type { HtmlImageLink } from '../../../../../shared/file-preview/htmlImageLinks';
import { Modal } from '../../components/Modal';
import { t } from '../../i18n';
import { textMetrics } from '../../theme/text';
import type { HtmlFileContext } from './HtmlPreparation';
import { nativeHtmlAsset } from './nativeHtmlAsset';

/** Only the generated image shell can report readiness; user documents never receive this bridge. */
export function HtmlImagePreview({ link, context, close }: {
  link: HtmlImageLink; context: HtmlFileContext; close: () => void;
}) {
  const load = useCallback<PreviewImageLoader>(async options => {
    const asset = await nativeHtmlAsset({ ...context, path: link.path,
      signal: options?.signal ?? new AbortController().signal });
    if (!/^image\/[a-z0-9.+-]+$/i.test(asset.mime)) throw new Error('Invalid image type');
    return `data:${asset.mime};base64,${asset.base64}`;
  }, [context.client, context.threadId, link.path]);
  const image = useImageViewer(load, true);
  const [displayed, setDisplayed] = useState(false);
  const source = useMemo(() => ({ baseUrl: 'about:blank', html: '<!doctype html><html><head>'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:;'
    + ' style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=8">'
    + '<style>html,body{margin:0;background:#000;min-height:100%}body{min-height:100vh;display:flex;'
    + 'align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style>'
    + `</head><body><img src="${image.url ?? ''}" onload="window.ReactNativeWebView.postMessage('loaded')"`
    + ' onerror="window.ReactNativeWebView.postMessage(\'error\')"></body></html>' }), [image.url]);
  const loading = image.loading || Boolean(image.url && !displayed);
  return <Modal visible animationType="fade" onRequestClose={close} statusBarStyle="light">
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('client.shared.closeImage')}
          onPress={close} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        {image.url && <WebView source={source} style={{ flex: 1, backgroundColor: '#000' }}
          accessibilityLabel={link.description} javaScriptEnabled incognito originWhitelist={['*']}
          onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} domStorageEnabled={false}
          setSupportMultipleWindows={false} setBuiltInZoomControls setDisplayZoomControls={false}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data === 'loaded') setDisplayed(true);
            if (nativeEvent.data === 'error') image.fail();
          }} onError={image.fail} />}
        {loading && <View style={{ position: 'absolute', inset: 0, justifyContent: 'center',
          alignItems: 'center', gap: 12, backgroundColor: '#000' }} accessibilityRole="progressbar">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ ...textMetrics(14, 21), color: '#fff', maxWidth: 400 }}>
            {t('client.shared.loadingFullImage')}</Text>
        </View>}
        {image.error && <View style={{ padding: 24, alignItems: 'center', gap: 16 }}>
          <Text style={{ ...textMetrics(14, 21), color: '#fff', maxWidth: 400 }}>
            {t('client.shared.couldNotLoadFullImage')}</Text>
          <Pressable accessibilityRole="button" onPress={image.request} style={{ padding: 12 }}>
            <Text style={{ ...textMetrics(14, 21), color: '#fff', maxWidth: 400 }}>
              {t('client.mobile.reloadOriginalImage')}</Text>
          </Pressable>
        </View>}
      </View>
    </SafeAreaView>
  </Modal>;
}
