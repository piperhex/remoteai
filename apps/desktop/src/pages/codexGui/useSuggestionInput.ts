import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { readEditor, writeEditor } from './skillEditorDom';
import type { ComposerText } from '../../../../../shared/conversation/types';

/** Ghost text never enters the editable DOM or the draft until the user accepts it with Tab or the touch action. */
export function useSuggestionInput(options: {
  editor: RefObject<HTMLDivElement>; text?: string; value: ComposerText; enabled: boolean;
  onChange: (value: ComposerText) => void; onUserInput?: () => void; onInputEnd?: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [dismissed, setDismissed] = useState<string | undefined>();
  useEffect(() => { setDismissed(undefined); }, [options.text, options.value.text, options.value.mentions.length]);
  const text = options.enabled && !options.value.text && !options.value.mentions.length
    && dismissed !== options.text ? options.text ?? '' : '';
  const available = useRef('');
  available.current = text;
  const dismiss = () => {
    available.current = '';
    setDismissed(latest.current.text);
    latest.current.onUserInput?.();
  };
  const restore = () => { setDismissed(undefined); latest.current.onInputEnd?.(); };
  const accept = () => {
    const text = available.current;
    const node = options.editor.current;
    if (!text || !node || readEditor(node).text) return false;
    // Native insertion retains undo where available; DOM fallback supports embedded editors and tests.
    node.focus();
    if (!document.execCommand?.('insertText', false, text)) writeEditor(node, { text, mentions: [] });
    const range = document.createRange();
    range.selectNodeContents(node); range.collapse(false);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    options.onChange({ text, mentions: [] });
    dismiss();
    return true;
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !accept()) return false;
    event.preventDefault();
    return true;
  };
  return { text, dismiss, restore, accept, keyDown };
}
