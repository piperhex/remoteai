import { useEffect, useMemo, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { FileClient } from '../../../../../shared/remote-chat/fileDownload';
import { htmlPreparationDocument } from './htmlPreparation.generated';
import { nativeHtmlAsset } from './nativeHtmlAsset';

export interface PreparedHtml { html: string; failed: boolean }
export interface HtmlFileContext { path: string; client: FileClient; threadId: string }

/** Only this inert parser has a native bridge; the rendered document uses a separate WebView without one. */
export function HtmlPreparation({ text, context, complete, fail }: {
  text: string; context: HtmlFileContext; complete: (result: PreparedHtml) => void; fail: () => void;
}) {
  const view = useRef<WebView>(null);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  const source = useMemo(() => ({ html: htmlPreparationDocument, baseUrl: 'about:blank' }), []);
  const message = async (data: string) => {
    if (controller.signal.aborted) return;
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return;
    const reply = value as Record<string, unknown>;
    if (reply.type === 'ready') {
      view.current?.injectJavaScript(`window.prepareHtml(${JSON.stringify({ text, path: context.path })}); true;`);
    } else if (reply.type === 'prepared' && typeof reply.html === 'string') {
      complete({ html: reply.html, failed: reply.failed === true });
    } else if (reply.type === 'error') fail();
    else if (reply.type === 'asset' && Number.isSafeInteger(reply.id) && typeof reply.path === 'string') {
      const asset = await nativeHtmlAsset({ ...context, path: reply.path, signal: controller.signal })
        .catch(() => undefined);
      if (!controller.signal.aborted) {
        view.current?.injectJavaScript(`window.htmlAsset(${JSON.stringify({ id: reply.id, ...asset })}); true;`);
      }
    }
  };
  return <WebView ref={view} source={source} style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}
    accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none"
    originWhitelist={['*']} onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
    onMessage={({ nativeEvent }) => { void message(nativeEvent.data).catch(fail); }} onError={fail}
    javaScriptEnabled allowFileAccess={false} allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
    setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} />;
}
