import { Dropdown, type MenuProps } from 'antd';
import { ClipboardPaste, Copy, Redo2, Scissors, SquareDashed, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MessageKey } from '../localization/messages';
import { useThreadLongPress } from './useThreadLongPress';
import { captureComposerSelection, editComposer, type ComposerEditAction,
  type ComposerEditor, type ComposerSelection } from './composerEditing';
import styles from './ComposerContextMenu.module.less';

const KEYBOARD_MENU_INSET = 16;
const actions = [
  ['undo', 'client.projectBrowser.undo', Undo2],
  ['redo', 'client.projectBrowser.redo', Redo2],
  ['cut', 'client.projectBrowser.cut', Scissors],
  ['copy', 'client.projectBrowser.copied', Copy],
  ['paste', 'client.projectBrowser.paste', ClipboardPaste],
  ['delete', 'client.projectBrowser.deleted', Trash2],
  ['selectAll', 'client.projectBrowser.selectAll', SquareDashed],
] as const;

/** One editing menu for the local rich-text composer and remote/web textareas. */
export function ComposerContextMenu({ children, scope, active = true, translate }: {
  children: ReactNode; scope?: string; active?: boolean; translate: (key: MessageKey) => string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<ComposerSelection | null>(null);
  const pointerSelection = useRef<ComposerSelection | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState<ComposerEditAction[]>([]);
  const busy = useRef(false);
  useEffect(() => {
    generation.current++; selection.current = null; pointerSelection.current = null; setOpen(false); setError('');
    return () => { generation.current++; };
  }, [scope, active]);
  const prepare = () => {
    const node = root.current?.querySelector<ComposerEditor>('textarea, [contenteditable]');
    if (!node || !active) return;
    generation.current++;
    const previous = pointerSelection.current;
    const saved = previous?.text && previous.valid() ? previous : captureComposerSelection(node);
    pointerSelection.current = null;
    selection.current = saved; saved.restore(); setError('');
    setDisabled(actions.filter(([action]) => {
      if (action === 'selectAll') return !saved.hasContent;
      if (action === 'copy') return !saved.text;
      if (!saved.editable) return true;
      if (action === 'cut' || action === 'delete') return !saved.text;
      return (action === 'undo' || action === 'redo') && !document.queryCommandEnabled(action);
    }).map(([action]) => action));
  };
  const gestures = useThreadLongPress(({ target, x, y }) => {
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    }));
  }, { enabled: active, nativeContextMenu: true });
  const run = async (action: ComposerEditAction) => {
    const saved = selection.current;
    if (!saved || busy.current || disabled.includes(action)) return;
    const current = generation.current;
    const valid = () => current === generation.current;
    busy.current = true;
    try { await editComposer(action, saved, valid); if (valid()) setOpen(false); }
    catch {
      if (valid()) setError(translate(action === 'paste'
        ? 'client.projectBrowser.unableToReadTheClipboardUseThePasteKeyboardShortcut'
        : 'client.chat.copyFailedSelectTheTextAndCopyItManually'));
    } finally { busy.current = false; }
  };
  const items: MenuProps['items'] = actions.flatMap(([action, label, Icon]) => [
    { key: action, label: translate(label), icon: <Icon size={16} />, disabled: disabled.includes(action),
      onClick: () => { void run(action); } },
    ...(action === 'redo' || action === 'delete' ? [{ type: 'divider' as const }] : []),
  ]);
  return <Dropdown trigger={['contextMenu']} open={open} disabled={!active} autoFocus
    onOpenChange={(next, info) => {
      if (info.source === 'menu') return;
      setOpen(next);
      if (!next) generation.current++;
    }}
    menu={{ items, 'aria-label': translate('client.projectBrowser.textActions') }}
    overlayClassName={styles.menu} overlayStyle={{ maxWidth: 400 }}
    dropdownRender={menu => <div className={styles.panel} onPointerDown={event => event.preventDefault()}
      onKeyDownCapture={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        generation.current++; setOpen(false); selection.current?.restore();
      }}>
      {menu}{error && <p role="alert" className={styles.error}>{error}</p>}
    </div>}>
    <div ref={root} className={styles.trigger} {...gestures} onContextMenuCapture={prepare}
      onPointerDownCapture={event => {
        const node = root.current?.querySelector<ComposerEditor>('textarea, [contenteditable]');
        // A right mouse-down can move the caret before contextmenu reaches the editor.
        pointerSelection.current = event.button === 2 && node ? captureComposerSelection(node) : null;
      }}
      onPointerDown={event => { if (event.pointerType !== 'mouse') gestures.onPointerDown(event); }}
      onKeyDownCapture={event => {
        if (!active || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
        event.preventDefault();
        const target = event.target as HTMLElement;
        const bounds = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
          clientX: bounds.left + KEYBOARD_MENU_INSET, clientY: bounds.top + bounds.height / 2, button: 2 }));
      }} onKeyDown={undefined}>
      {children}
    </div>
  </Dropdown>;
}
