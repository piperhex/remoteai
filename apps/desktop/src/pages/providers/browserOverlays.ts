export const browserOverlayAttributes = ['style', 'class', 'aria-modal', 'open', 'hidden'];

/** Native child WebViews sit above the document, including its modal top layer. */
export function hasBrowserOverlay(host: HTMLElement, includeAriaModals = true): boolean {
  const selector = includeAriaModals ? 'dialog[open], [aria-modal="true"]' : 'dialog[open]';
  return [...document.querySelectorAll(selector)].some(overlay =>
    !overlay.contains(host) && overlay.getClientRects().length > 0);
}
