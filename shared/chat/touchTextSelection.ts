/** Also embedded in the native math WebView; keep this function self-contained. */
export function installTouchTextSelection(root: HTMLElement): () => void {
  const longPressMs = 500;
  const moveTolerancePx = 10;
  let touchInput = false;
  let gesture: { x: number; y: number; started: number; allowed: boolean } | undefined;
  const cancel = () => { gesture = undefined; };
  const ready = () => gesture && (gesture.allowed || performance.now() - gesture.started >= longPressMs);
  const start = (event: TouchEvent) => {
    touchInput = true;
    cancel();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    const selection = root.ownerDocument.getSelection();
    const selected = Boolean(selection && !selection.isCollapsed && root.contains(selection.anchorNode));
    gesture = { x: touch.clientX, y: touch.clientY, started: performance.now(), allowed: selected };
  };
  const move = (event: TouchEvent) => {
    if (!gesture || gesture.allowed) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y)
      > moveTolerancePx) cancel();
  };
  const end = () => {
    // Some browsers create the native range on release, after recognizing the long press.
    if (gesture && ready()) gesture.allowed = true;
    else cancel();
  };
  const select = (event: Event) => { if (touchInput && !ready()) event.preventDefault(); };
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') { touchInput = false; cancel(); }
  };
  const keyboard = () => { touchInput = false; cancel(); };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: true });
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', cancel);
  root.addEventListener('selectstart', select);
  root.addEventListener('pointerdown', pointer);
  root.ownerDocument.addEventListener('keydown', keyboard);
  return () => {
    root.removeEventListener('touchstart', start);
    root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', end);
    root.removeEventListener('touchcancel', cancel);
    root.removeEventListener('selectstart', select);
    root.removeEventListener('pointerdown', pointer);
    root.ownerDocument.removeEventListener('keydown', keyboard);
  };
}
