import { copyText } from '../clipboard';
import { readPastedContent } from './clipboard';

export type ComposerEditor = HTMLTextAreaElement | HTMLDivElement;
export type ComposerEditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';

const content = (node: ComposerEditor) => node instanceof HTMLTextAreaElement ? node.value : node.innerHTML;
const editable = (node: ComposerEditor) => node instanceof HTMLTextAreaElement
  ? !node.disabled && !node.readOnly : node.isContentEditable;

/** Keep the editor's selection while the menu receives keyboard focus. */
export function captureComposerSelection(node: ComposerEditor) {
  const original = content(node);
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const saved = range && node.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
  const start = node instanceof HTMLTextAreaElement ? node.selectionStart : 0;
  const end = node instanceof HTMLTextAreaElement ? node.selectionEnd : 0;
  const text = node instanceof HTMLTextAreaElement ? node.value.slice(start, end) : saved?.toString() ?? '';
  return {
    node, text, hasContent: Boolean(node instanceof HTMLTextAreaElement ? node.value : node.textContent),
    editable: editable(node),
    valid: () => node.isConnected && content(node) === original,
    restore: () => {
      node.focus({ preventScroll: true });
      if (node instanceof HTMLTextAreaElement) { node.setSelectionRange(start, end); return; }
      const current = window.getSelection();
      const caret = saved ?? document.createRange();
      if (!saved) { caret.selectNodeContents(node); caret.collapse(false); }
      current?.removeAllRanges(); current?.addRange(caret);
    },
  };
}

export type ComposerSelection = ReturnType<typeof captureComposerSelection>;

async function readClipboard(): Promise<DataTransfer> {
  const data = new DataTransfer();
  if (!navigator.clipboard?.read) {
    data.setData('text/plain', await navigator.clipboard.readText());
    return data;
  }
  for (const item of await navigator.clipboard.read()) {
    for (const type of item.types) {
      if (type !== 'text/plain' && type !== 'text/html' && !type.startsWith('image/')) continue;
      const blob = await item.getType(type);
      if (type.startsWith('text/')) data.setData(type, await blob.text());
      else data.items.add(new File([blob], 'clipboard-image', { type }));
    }
  }
  return data;
}

async function paste(selection: ComposerSelection, valid: () => boolean) {
  const { node } = selection;
  // WebViews may support native paste, including OS file copies absent from the browser Clipboard API.
  let dispatched = false;
  const observed = () => { dispatched = true; };
  node.addEventListener('paste', observed);
  try { if (document.execCommand('paste') || dispatched) return; }
  catch { /* Some browsers reject native paste but still expose the permission-based Clipboard API. */ }
  finally { node.removeEventListener('paste', observed); }
  const clipboardData = await readClipboard();
  if (!valid() || !selection.valid() || !editable(node)) return;
  selection.restore();
  // Reuse the composer's image, file and long-text attachment handling before inserting plain text.
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData });
  if (node.dispatchEvent(event)) {
    const text = readPastedContent(clipboardData).text;
    if (text) document.execCommand('insertText', false, text);
  }
}

export async function editComposer(action: ComposerEditAction, selection: ComposerSelection, valid: () => boolean) {
  if (!valid() || !selection.valid()) return;
  selection.restore();
  const { node } = selection;
  if (action === 'selectAll') {
    if (node instanceof HTMLTextAreaElement) node.select();
    else {
      const range = document.createRange(); range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    }
    return;
  }
  if (action === 'copy' || action === 'cut') {
    if (!document.execCommand('copy')) await copyText(selection.text);
    if (action === 'copy' || !valid() || !selection.valid()) return;
    selection.restore();
  }
  if (!editable(node)) return;
  if (action === 'paste') await paste(selection, valid);
  else document.execCommand(action === 'cut' ? 'delete' : action);
}
