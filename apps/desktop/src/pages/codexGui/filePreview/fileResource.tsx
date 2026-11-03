import { useEffect, useState } from 'react';
import type { FilePreviewData, filePreviewApi } from './api';
import type { BrowserResource } from './browserResources';
import { FilePreviewPanel } from './FilePreviewPanel';
import { fileResourceUrl } from './browserResources';
import type { FilePreviewTarget } from './usePreviewHistory';
import { uiText } from '../../../i18n/uiText';

function FileResourceContent({ initial, active, reload }: {
  initial: FilePreviewData; active: boolean; reload?: () => Promise<FilePreviewData>;
}) {
  const [data, setData] = useState(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!reload) return;
    let cancelled = false;
    void reload().then(value => { if (!cancelled) setData(value); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [reload]);
  return <>{failed && <p role="status">{uiText('client.filePreview.unavailable')}</p>}
    <FilePreviewPanel key={data.sessionId} data={data} active={active} embedded /></>;
}

/** Keep one session per resource, replacing it only after a successful reload. */
export function fileBrowserResource(options: {
  data: FilePreviewData; key: string; api: typeof filePreviewApi; target: FilePreviewTarget;
}): BrowserResource {
  let current = options.data;
  let closed = false;
  let generation = 0;
  const close = (data: FilePreviewData) => { void options.api.close(data.sessionId)
    .catch(error => console.error('Failed to release browser resource', error)); };
  const reload = async () => {
    const id = ++generation;
    const data = await options.api.open(options.target);
    if (!data) throw new Error('Resource unavailable');
    if (closed || generation !== id) { close(data); return current; }
    close(current); current = data; return data;
  };
  return { key: options.key, title: current.name, url: fileResourceUrl(current.path),
    release: () => { if (!closed) { closed = true; close(current); } },
    render: props => <FileResourceContent initial={current} active={props.active}
      reload={props.command?.action === 'reload' ? reload : undefined} /> };
}
