import { cloneElement, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Copy, MessageCircle, Quote } from 'lucide-react';
import { displayText as t } from '../localization/messages';
import { useThreadLongPress } from '../chat/useThreadLongPress';
import { messageMenuActions } from './messageMenuActions';
import { MESSAGE_MENU_PADDING, messageMenuPosition, messageMenuSize, type MenuAnchor } from './messageMenuLayout';
import type { LoungeMessageMenuActions } from './LoungeMessageMenu';
import './mobileMessageMenu.css';

const icons = { copy: Copy, reply: Quote, direct: MessageCircle, block: Ban };
type ActionKey = keyof typeof icons;
type Props = LoungeMessageMenuActions & {
  children: ReactElement<HTMLAttributes<HTMLElement>>; select: (key: ActionKey) => void;
};

export function MobileLoungeMessageMenu({ children, select, ...actions }: Props) {
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const trigger = useRef<HTMLElement>();
  const close = () => setAnchor(undefined);
  const gestures = useThreadLongPress(({ target }) => {
    trigger.current = target;
    const rect = target.getBoundingClientRect();
    setAnchor({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  });
  return <>{cloneElement(children, { ...gestures,
    className: `${children.props.className ?? ''} lounge-mobile-menu-trigger${anchor ? ' is-menu-open' : ''}`,
  })}{anchor && <MessagePopover anchor={anchor} actions={messageMenuActions(actions)} close={close}
    select={key => { close(); select(key); }} restoreFocus={() => trigger.current?.focus({ preventScroll: true })} />}</>;
}

function MessagePopover({ anchor, actions, close, select, restoreFocus }: {
  anchor: MenuAnchor; actions: ReturnType<typeof messageMenuActions>; close: () => void;
  select: (key: ActionKey) => void; restoreFocus: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const size = messageMenuSize({ actionCount: actions.length, viewportWidth: window.visualViewport?.width ?? innerWidth });
  const [position, setPosition] = useState<ReturnType<typeof messageMenuPosition>>();
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const update = () => {
      const viewport = window.visualViewport;
      setPosition(messageMenuPosition({ anchor, menu: node.getBoundingClientRect(), viewport: {
        x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight,
      } }));
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(node);
    node.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [anchor]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); restoreFocus(); }
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    window.visualViewport?.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true);
      window.visualViewport?.removeEventListener('resize', close);
    };
  }, [close, restoreFocus]);
  return createPortal(<div className="lounge-mobile-menu-layer" onContextMenu={event => event.preventDefault()}>
    <div className="lounge-mobile-menu-backdrop" onMouseDown={event => event.preventDefault()} onClick={close} />
    <div ref={menu} role="menu" aria-label={t('client.lounge.messageActions')}
      className={`lounge-mobile-message-menu${position?.above ? ' is-above' : ''}`}
      style={{ left: position?.left, top: position?.top, visibility: position ? 'visible' : 'hidden',
        width: size.width, '--menu-columns': size.columns, '--menu-padding': `${MESSAGE_MENU_PADDING}px`,
        '--menu-arrow': `${position?.arrow ?? 24}px` } as CSSProperties}
      onKeyDown={event => {
        if (!['Tab', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll('button')];
        const previous = event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (previous ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}>
      {actions.map(action => {
        const Icon = icons[action.key];
        return <button key={action.key} type="button" role="menuitem" onClick={() => select(action.key)}>
          <Icon size={20} aria-hidden /><span>{t(action.label)}</span></button>;
      })}
    </div>
  </div>, document.body);
}
