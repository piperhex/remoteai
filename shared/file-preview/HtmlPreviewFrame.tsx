import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { displayText as t } from '../localization/messages';
import type { PreviewLoader } from './kinds';
import { prepareHtmlPreview } from './htmlAssets';
import { loadHtmlMedia, type HtmlMediaUpdate } from './htmlMedia';
import receiverUrl from './htmlMediaReceiver.js?url&no-inline';
import { findHtmlImageLink, type HtmlImageLink } from './htmlImageLinks';
import { HtmlImagePreview } from './HtmlImagePreview';

type PreparedPreview = Awaited<ReturnType<typeof prepareHtmlPreview>> & {
  channel: string; controller: AbortController;
};
const statusStyle = { maxWidth: 400 };

export function HtmlPreviewFrame({ text, path, load, className }: {
  text: string; path: string; load: PreviewLoader; className?: string;
}) {
  const [result, setResult] = useState<PreparedPreview>();
  const [failed, setFailed] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [image, setImage] = useState<HtmlImageLink>();
  const frame = useRef<HTMLIFrameElement>(null);
  const started = useRef<PreparedPreview>();
  useEffect(() => {
    const controller = new AbortController();
    const channel = crypto.randomUUID();
    setResult(undefined); setFailed(false); setLoadingMedia(false); setImage(undefined);
    void prepareHtmlPreview({ text, path, load, signal: controller.signal, mediaChannel: channel,
      mediaReceiverUrl: new URL(receiverUrl, window.location.href).href }).then(value => {
      if (!controller.signal.aborted) {
        setResult({ ...value, channel, controller }); setFailed(value.failed); setLoadingMedia(value.media.length > 0);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [text, path, load]);
  const loadMedia = () => {
    if (!result || started.current === result) return;
    started.current = result;
    const { controller, channel } = result;
    void loadHtmlMedia({ assets: result.media, signal: controller.signal, update: (asset, value) => {
      const update: HtmlMediaUpdate = { channel, id: asset.id, attribute: asset.attribute, value };
      frame.current?.contentWindow?.postMessage(update, '*');
      if (result.hasFailed()) setFailed(true);
    } }).then(() => {
      if (!controller.signal.aborted) {
        frame.current?.contentWindow?.postMessage({ channel, type: 'complete' }, '*');
      }
    }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoadingMedia(false); } });
  };
  useLayoutEffect(() => {
    const ready = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== result?.channel) return;
      if (event.data?.type === 'ready') loadMedia();
      if (event.data?.type === 'loaded') { setLoadingMedia(false); if (event.data.failed) setFailed(true); }
      if (event.data?.type === 'image') {
        const link = findHtmlImageLink(result?.imageLinks, event.data.url);
        if (link) setImage(link);
      }
    };
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [result]);
  if (!result) return <p role="status" style={statusStyle}>
    {t(failed ? 'client.filePreview.unavailable' : 'client.projectBrowser.loading')}</p>;
  return <>
    {loadingMedia && <p role="status" style={statusStyle}>{t('client.chat.loadingImage')}</p>}
    {failed && <p role="status" style={statusStyle}>{t('client.filePreview.someHtmlAssetsUnavailable')}</p>}
    <iframe ref={frame} title={t('client.downloads.htmlPreview')}
      srcDoc={result.html} sandbox="allow-scripts"
      referrerPolicy="no-referrer" className={className} />
    {image && <HtmlImagePreview key={image.url} link={image} load={load} close={() => setImage(undefined)} />}
  </>;
}
