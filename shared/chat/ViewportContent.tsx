import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { observeViewport } from './viewportObserver';
import { restoreVirtualScroll, type VirtualScrollAnchor } from './virtualScroll';
import { ImagePlaceholder } from './ImageThumbnail';
import imageStyles from './imageThumbnail.module.css';

const MESSAGE_ESTIMATE = 96;
const IMAGE_ESTIMATE = { height: 180, width: 320 };

function isInteracting(node: HTMLElement) {
  const selection = window.getSelection();
  return node.contains(document.activeElement)
    || Boolean(node.querySelector('textarea, input, [contenteditable="true"], details[open], [aria-expanded="true"]'))
    || Boolean(document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]'))
    || Boolean(selection && !selection.isCollapsed
      && (node.contains(selection.anchorNode) || node.contains(selection.focusNode)));
}

/** Keep lightweight measured slots while releasing offscreen rich content and decoded images. */
export function ViewportContent({ children, image = false, fixedImage = false, enabled = true }: {
  children: () => ReactNode; image?: boolean; fixedImage?: boolean; enabled?: boolean;
}) {
  const node = useRef<HTMLDivElement & HTMLSpanElement>(null);
  const supported = typeof IntersectionObserver !== 'undefined';
  // Measure new message rows once before recycling them. Images remain deferred during that measurement.
  const [visible, setVisible] = useState(!image || !supported);
  const anchor = useRef<VirtualScrollAnchor | null>(null);
  const settling = useRef<VirtualScrollAnchor | null>(null);
  const size = useRef(image ? IMAGE_ESTIMATE : { height: MESSAGE_ESTIMATE, width: 0 });
  const mounted = visible || !enabled || !supported;
  useLayoutEffect(() => {
    if (!enabled || !supported || !node.current) return;
    const element = node.current;
    return observeViewport(element, (next, snapshot) => {
      if (!next && isInteracting(element)) return;
      settling.current = null;
      anchor.current = fixedImage ? null : snapshot;
      setVisible(next);
    });
  }, [enabled, supported, fixedImage]);
  useLayoutEffect(() => {
    if (!mounted || !node.current || fixedImage) return;
    const measure = () => {
      const bounds = node.current?.getBoundingClientRect();
      if (bounds) size.current = { height: bounds.height, width: bounds.width };
      const pending = settling.current;
      // Keep a nested tool's reading position through image decoding, until the reader scrolls again.
      if (image && pending && Math.abs(pending.root.scrollTop - pending.offset) <= 1) {
        restoreVirtualScroll(pending);
      }
    };
    measure();
    if (anchor.current) {
      restoreVirtualScroll(anchor.current);
      settling.current = anchor.current;
      anchor.current = null;
    }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [mounted, image, fixedImage]);
  const Tag = image ? 'span' : 'div';
  return <Tag ref={node} data-viewport-content={mounted ? 'visible' : 'placeholder'}
    className={fixedImage ? imageStyles.slot : undefined}
    style={fixedImage ? undefined : { display: image ? 'block' : 'flex', flexDirection: image ? undefined : 'column',
      minWidth: 0, maxWidth: '100%',
      verticalAlign: image ? 'top' : undefined,
      height: mounted ? undefined : size.current.height,
      width: image ? (mounted ? 'fit-content'
        : `min(${size.current.width}px, var(--message-image-max-width, 100%))`) : undefined }}>
    {mounted ? children() : fixedImage && <span className={imageStyles.frame}><ImagePlaceholder /></span>}
  </Tag>;
}
