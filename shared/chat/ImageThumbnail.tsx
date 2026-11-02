import { useState, type ReactNode } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import { displayText, type MessageTranslator } from '../localization/messages';
import styles from './imageThumbnail.module.css';

export function ImagePlaceholder({ failed = false, children, translate = displayText }: {
  failed?: boolean; children?: ReactNode; translate?: MessageTranslator;
}) {
  const Icon = failed ? ImageOff : ImageIcon;
  return <span className={styles.placeholder} role="status">
    <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
    <span>{translate(failed ? 'client.composer.couldNotLoadImage' : 'client.chat.loadingImage')}</span>
    {children}
  </span>;
}

/** The viewport owns the size; decoding and failure only replace content inside that slot. */
export function ImageThumbnail({ url, description, title, failed, retry, onError, onPreview,
  fallback, className = '', translate = displayText }: {
  url?: string; description: string; title?: string; failed?: boolean; retry?: () => void;
  onError: () => void; onPreview: () => void; fallback?: ReactNode;
  className?: string; translate?: MessageTranslator;
}) {
  const [loadedSource, setLoadedSource] = useState<string>();
  if (failed) return <span className={styles.frame}>
    <ImagePlaceholder failed translate={translate}>
      <span className={styles.actions}>
        {retry && <button type="button" onClick={retry}>{translate('client.terminal.retry')}</button>}
        {fallback}
      </span>
    </ImagePlaceholder>
  </span>;
  if (!url) return <span className={styles.frame}><ImagePlaceholder translate={translate} /></span>;
  const loaded = loadedSource === url;
  return <button type="button" className={`${styles.frame} ${styles.preview} ${className}`}
    aria-label={translate('client.chat.enlarge', { value1: description })} aria-busy={!loaded}
    title={title} onClick={onPreview}>
    {!loaded && <ImagePlaceholder translate={translate} />}
    <img src={url} alt={description} loading="lazy" decoding="async" referrerPolicy="no-referrer"
      className={loaded ? styles.loaded : styles.pending}
      onLoad={() => setLoadedSource(url)} onError={() => { setLoadedSource(undefined); onError(); }} />
  </button>;
}
