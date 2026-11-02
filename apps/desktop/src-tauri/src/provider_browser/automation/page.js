(request) => {
  const key = '__remoteAiPreviewRefs';
  const visible = element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = element => (element.getAttribute('aria-label') || element.labels?.[0]?.innerText
    || element.innerText || element.getAttribute('title') || element.getAttribute('placeholder') || '').trim().slice(0, 240);
  if (request.action === 'snapshot') {
    const snapshot = request.snapshotId;
    const refs = new Map();
    const nodes = [...document.querySelectorAll('a[href],button,input,textarea,select,[role],summary,[contenteditable="true"]')]
      .filter(visible).slice(0, 250).map((element, index) => {
        const reference = `${snapshot}:${index}`;
        refs.set(reference, element);
        const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          || element instanceof HTMLSelectElement;
        const bounds = element.getBoundingClientRect();
        return { reference, role: element.getAttribute('role') || element.tagName.toLowerCase(),
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          name: label(element), type: element.getAttribute('type') || undefined,
          value: field && !['password', 'file', 'hidden'].includes(element.type) ? element.value : undefined,
          disabled: Boolean(element.disabled), href: element instanceof HTMLAnchorElement ? element.href : undefined };
      });
    window[key] = { refs, url: location.href };
    return { url: location.href, title: document.title, readyState: document.readyState,
      text: (document.body?.innerText || '').slice(0, 24000), elements: nodes,
      truncated: nodes.length === 250, viewport: { width: innerWidth, height: innerHeight } };
  }
  if (['back', 'forward', 'reload'].includes(request.action)) {
    if (request.action === 'reload') location.reload();
    else history[request.action]();
    return { dispatched: true };
  }
  if (request.action === 'scroll') {
    window.scrollBy({ left: request.x, top: request.y, behavior: 'instant' });
    return { dispatched: true };
  }
  if (request.action === 'key') {
    return keyboard(request.key);
  }
  const state = window[key];
  const element = state?.url === location.href ? state.refs.get(request.reference) : null;
  if (!element?.isConnected || !visible(element)) return { error: 'stale' };
  if (element.disabled) return { error: 'disabled' };
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  element.focus();
  const bounds = element.getBoundingClientRect();
  updatePointer({ ownerId: 'embedded-preview', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
    phase: request.previewOnly ? 'move' : 'press', animate: Boolean(request.previewOnly) });
  if (request.previewOnly) return { prepared: true };
  if (request.action === 'type') {
    const focus = document.createElement('div');
    focus.setAttribute('aria-hidden', 'true'); focus.inert = true;
    focus.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;`
      + `left:${bounds.x - 3}px;top:${bounds.y - 3}px;width:${bounds.width + 6}px;height:${bounds.height + 6}px;`
      + 'border:2px solid #147d71;border-radius:6px;box-shadow:0 0 0 3px #147d7120';
    document.documentElement.append(focus);
    setTimeout(() => focus.remove(), 1200);
  }
  setTimeout(() => updatePointer({ ownerId: 'embedded-preview', x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2, phase: 'release', animate: false }), 120);
  if (request.action === 'click') element.click();
  else if (request.action === 'type') {
    if (element instanceof HTMLInputElement && element.type === 'file') return { error: 'unsupported' };
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, request.text);
    } else if (element.isContentEditable) element.textContent = request.text;
    else return { error: 'unsupported' };
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (request.action === 'select' && element instanceof HTMLSelectElement) {
    if (![...element.options].some(option => option.value === request.value)) return { error: 'unsupported' };
    element.value = request.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else return { error: 'unsupported' };
  return { dispatched: true, url: location.href };
}
