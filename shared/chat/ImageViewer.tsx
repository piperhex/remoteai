import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useImageViewer } from './useImageViewer';
import { clampZoom, INITIAL_TRANSFORM, moveImage, type Point } from './imageTransform';
import './imageViewer.css';

interface Props {
  thumbnail: string; description: string; load: () => Promise<string>; close: () => void;
  download?: (url: string) => void | Promise<void>;
  contextMenu?: (event: MouseEvent, url: string) => void;
  feedback?: string;
  translate?: (text: string) => string;
}

export function ImageViewer({ thumbnail, description, load, close, download, contextMenu, feedback,
  translate = (text: string) => text }: Props) {
  const image = useImageViewer(load);
  const [downloadError, setDownloadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const pointers = useRef(new Map<number, Point>());
  const anchor = useRef({ before: transform, start: [] as Point[] });
  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
  const rebase = () => { anchor.current = { before: transform, start: [...pointers.current.values()] }; };
  return <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal(); }}
    className="cs-image-viewer" aria-label={description} onCancel={close}>
    <div className="cs-image-stage" onContextMenu={(event) => {
      if (!contextMenu) return;
      event.preventDefault();
      if (image.url && !image.error) contextMenu(event, image.url);
    }} onWheel={(event) => setTransform((old) => ({ ...old,
      scale: clampZoom(old.scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2)) }))}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, point(event)); rebase();
      }} onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, point(event));
        setTransform(moveImage({ ...anchor.current, current: [...pointers.current.values()] }));
      }} onPointerUp={(event) => { pointers.current.delete(event.pointerId); rebase(); }}
      onPointerCancel={() => pointers.current.clear()} onDoubleClick={() => setTransform(INITIAL_TRANSFORM)}>
      <img src={image.url ?? thumbnail} alt={description} draggable={false} referrerPolicy="no-referrer"
        onError={image.fail} style={{ transform: `translate(${transform.x}px, ${transform.y}px) `
          + `rotate(${transform.rotation}deg) scale(${transform.scale})` }} />
    </div>
    <button type="button" className="cs-image-close" aria-label={translate('关闭图片')} onClick={close}>×</button>
    {download && <button type="button" className="cs-image-download" disabled={saving || image.loading}
      onClick={async () => {
        setSaving(true);
        setDownloadError('');
        try { await download(await image.loadOriginal()); }
        catch (error) { setDownloadError(error instanceof Error ? error.message : translate('下载失败，请重试。')); }
        finally { setSaving(false); }
      }}>{translate(saving ? '正在保存…' : '下载图片')}</button>}
    {!image.url && !image.loading && <button type="button" className="cs-image-original" onClick={image.request}>
        {translate(image.error ? '重新加载原图' : '查看原图')}</button>}
    <div className="cs-image-toolbar">
      <button type="button" aria-label={translate('缩小图片')} onClick={() => setTransform((v) => ({ ...v,
        scale: clampZoom(v.scale / 1.5) }))}>−</button>
      <button type="button" aria-label={translate('还原图片')} onClick={() => setTransform(INITIAL_TRANSFORM)}>
        {Math.round(transform.scale * 100)}%</button>
      <button type="button" aria-label={translate('放大图片')} onClick={() => setTransform((v) => ({ ...v,
        scale: clampZoom(v.scale * 1.5) }))}>+</button>
      <button type="button" aria-label={translate('旋转图片')} onClick={() => setTransform((v) => ({ ...v,
        rotation: (v.rotation + 90) % 360 }))}>↻</button>
    </div>
    {image.loading && <div className="cs-image-status" role="status">{translate('正在加载原图…')}</div>}
    {downloadError && <div className="cs-image-status" role="status">{downloadError}</div>}
    {feedback && <div className="cs-image-status" role="status">{feedback}</div>}
    {image.error && <div className="cs-image-status" role="status">{translate('原图加载失败')}</div>}
  </dialog>;
}
