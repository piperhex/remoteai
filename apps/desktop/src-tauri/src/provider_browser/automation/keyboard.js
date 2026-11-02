(key) => {
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return { error: 'unsupported' };
  const accepted = target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  try {
    if (!accepted) return { dispatched: true };
    if (key === 'Tab') {
      const candidates = [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')]
        .filter(node => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length
          && getComputedStyle(node).visibility !== 'hidden');
      candidates.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
      candidates[(candidates.indexOf(target) + 1) % candidates.length]?.focus();
      return { dispatched: true };
    }
    if (key === 'Enter') {
      if (target instanceof HTMLInputElement && target.form) target.form.requestSubmit();
      else if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) target.click();
      else return { error: 'unsupported' };
      return { dispatched: true };
    }
    const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (!editable || target.readOnly || target.selectionStart === null) return { error: 'unsupported' };
    const start = target.selectionStart; const end = target.selectionEnd;
    if (key === 'Home') target.setSelectionRange(0, 0);
    else if (key === 'End') target.setSelectionRange(target.value.length, target.value.length);
    else if (key === 'ArrowLeft') target.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1));
    else if (key === 'ArrowRight') target.setSelectionRange(end + 1, end + 1);
    else if (key === 'Backspace' || key === 'Delete') {
      const from = start === end && key === 'Backspace' ? Math.max(0, start - 1) : start;
      const to = start === end && key === 'Delete' ? end + 1 : end;
      target.setRangeText('', from, to, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else return { error: 'unsupported' };
    return { dispatched: true };
  } finally { target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); }
}
