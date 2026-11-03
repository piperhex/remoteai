import { lazy, Suspense, useEffect, useState } from 'react';
import { displayText as t } from '../localization/messages';

const PdfPreview = lazy(() => import('./PdfPreview'));

export function PdfUrlPreview({ url, name }: { url: string; name: string }) {
  const [file, setFile] = useState<Blob>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFile(undefined); setFailed(false);
    void fetch(url, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('PDF unavailable');
      return response.blob();
    }).then(value => { if (!controller.signal.aborted) setFile(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url]);
  const feedback = <p role="status">{t(failed ? 'client.filePreview.unavailable' : 'client.projectBrowser.loading')}</p>;
  return <div className="website-file-content" data-resource-pdf>
    {file ? <Suspense fallback={feedback}><PdfPreview file={file} name={name} /></Suspense> : feedback}
  </div>;
}
