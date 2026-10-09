import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { editedImageMessage, imageEditorHtml } from './imageEditorHtml';
import { IMAGE_EDITOR_ASSET } from './imageEditorAsset';
import type { ConnectionMode } from '../remote-chat/protocol';
import './imageEditor.css';

export function ImageEditor({ dataUrl, save, close, translate: t, language, mode }: {
  dataUrl: string; save: (dataUrl: string) => void; close: () => void;
  translate: (text: string) => string; language: string; mode?: ConnectionMode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => imageEditorHtml(dataUrl, t, language, {
    scriptUrl: new URL(`${import.meta.env.BASE_URL}${IMAGE_EDITOR_ASSET}`, document.baseURI).href, mode,
  }), [dataUrl, t, language, mode]);
  const [error, setError] = useState('');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || typeof event.data !== 'string') return;
      try {
        if (event.data === '{"type":"cancel"}') { close(); return; }
        const dataUrl = editedImageMessage(event.data, mode);
        if (!dataUrl) return;
        save(dataUrl);
        close();
      } catch { setError(t("图片未保存，请减少标注或图片后重试。")); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [save, close, t, mode]);
  const loaded = () => {
    const editorDocument = frame.current?.contentDocument;
    if (editorDocument?.documentElement.dataset.editorInitialized !== 'true') {
      editorDocument?.getElementById('cancel')?.addEventListener('click', close, { once: true });
      setError(t('图片无法编辑，请重新打开后再试。'));
    }
  };
  return <Modal open centered footer={null} title={null} closable={{ 'aria-label': t('关闭图片') }} maskClosable={false}
    onCancel={close} width={1120} className="chat-image-editor" wrapClassName="chat-image-editor-wrap" destroyOnClose
    transitionName="" maskTransitionName="">
    {/* Only our own editor and validated image data are embedded. Keeping the local origin lets
        Chromium deliver pointer gestures reliably; the document CSP only permits local images and scripts. */}
    <iframe ref={frame} title={t("图片标注")} srcDoc={html} sandbox="allow-scripts allow-same-origin" onLoad={loaded} />
    {!!error && <p role="alert">{t(error)}</p>}
  </Modal>;
}
