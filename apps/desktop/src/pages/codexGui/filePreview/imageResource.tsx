import { useEffect, useState } from 'react';
import { BrowserImagePreview } from '../../../../../../shared/file-preview/BrowserImagePreview';
import { fileResourceUrl, type BrowserResource } from './browserResources';
import { uiText } from '../../../i18n/uiText';

function ImageResource({ title, load }: { title: string; load: () => Promise<string> }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void load().then(value => { if (!cancelled) { setUrl(value); setFailed(!value); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [load]);
  return url ? <BrowserImagePreview src={url} name={title} /> : <p role="status" className="chat-file-preview-note">
    {uiText(failed ? 'client.filePreview.unavailable' : 'client.chat.loadingImage')}</p>;
}

export function imageBrowserResource(options: {
  key: string; title: string; source: string; load: () => Promise<string>;
}): BrowserResource {
  return { key: options.key, title: options.title,
    url: /^https?:\/\//i.test(options.source) ? options.source : fileResourceUrl(options.title),
    render: () => <ImageResource title={options.title} load={options.load} /> };
}
