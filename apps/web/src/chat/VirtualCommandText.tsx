import { useLayoutEffect, useRef } from 'react';
import { useVirtualText } from '../../../../shared/chat/useVirtualText';
import { chunkDisplayText } from '../../../../shared/chat/virtualText';
import { ChatCopyButton } from './ChatCopyButton';
import { t } from '../i18n';
import './virtualCommandText.css';

export function VirtualCommandText({ text, label, command = false, empty = '' }: {
  text: string; label: string; command?: boolean; empty?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const virtual = useVirtualText(text || empty);
  const current = useRef(virtual);
  current.current = virtual;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      current.current.resize({ width: node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: node.clientHeight, characterWidth: parseFloat(style.fontSize) * 0.65,
        lineHeight: parseFloat(style.lineHeight) });
      node.querySelectorAll<HTMLElement>('[data-text-start]').forEach(row => {
        const chunk = current.current.rows.find(chunk => chunk.start === Number(row.dataset.textStart));
        if (chunk) current.current.measure(chunk.start, chunk.text, row.getBoundingClientRect().height);
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.querySelectorAll('[data-text-start]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [text, empty, virtual.rows[0]?.start, virtual.rows.at(-1)?.start]);
  return <div className={`chat-virtual-command${command ? ' is-command' : ''}`}>
    <div ref={viewport} className="chat-virtual-command-viewport" role="region"
      aria-label={t(command ? 'client.chat.command' : 'client.chat.output')} tabIndex={0}
      onScroll={event => virtual.scroll(event.currentTarget.scrollTop)}>
      <div aria-hidden style={{ height: virtual.before }} />
      {virtual.rows.map(chunk => <pre key={chunk.start} data-text-start={chunk.start}>
        {chunkDisplayText(chunk.text)}</pre>)}
      <div aria-hidden style={{ height: virtual.after }} />
    </div>
    {!!text && <div className="chat-virtual-command-copy"><ChatCopyButton text={text} label={label} iconOnly /></div>}
  </div>;
}
